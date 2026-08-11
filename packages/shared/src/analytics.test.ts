import { describe, expect, it } from "vitest";

import {
  analyticsBatchSchema,
  analyticsEventSchema,
  analyticsSettingsSchema,
  ANALYTICS_BATCH_MAX_EVENTS,
  DEFAULT_ANALYTICS_SETTINGS,
  ENGAGEMENT,
  heatmapFilterSchema,
  isBounce,
  isEngagedSession,
  rateWebVital,
  sourceLabel,
  WEB_VITALS,
  WEB_VITAL_THRESHOLDS,
  webVitalBucket,
  webVitalBucketEdges,
} from "./analytics";

const batch = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  batchId: "3f1a1c5e-6b2d-4a7f-9c11-2b0f6a8d4e51",
  sessionId: "8d4e51aa-6b2d-4a7f-9c11-2b0f6a8d4e52",
  pageViewId: "8d4e51bb-6b2d-4a7f-9c11-2b0f6a8d4e53",
  sentAt: "2026-08-11T12:00:00.000Z",
  path: "/about",
  device: "mobile",
  source: { kind: "direct" },
  events: [{ type: "page_view" }],
  ...overrides,
});

describe("the event envelope", () => {
  it("accepts a well-formed batch", () => {
    expect(analyticsBatchSchema.safeParse(batch()).success).toBe(true);
  });

  it("has nowhere to put a tenant identifier", () => {
    // The property this test exists for: the server derives workspace, project and page from the
    // hostname and the route manifest. A browser that sends them is rejected rather than believed.
    for (const forged of ["workspaceId", "projectId", "pageId"]) {
      const result = analyticsBatchSchema.safeParse(batch({ [forged]: "someone-elses-tenant" }));
      expect(result.success, `${forged} was accepted`).toBe(false);
    }
  });

  it("rejects an unknown field rather than ignoring it", () => {
    expect(analyticsBatchSchema.safeParse(batch({ extra: 1 })).success).toBe(false);
  });

  it("bounds the number of events in one batch", () => {
    const under = Array.from({ length: ANALYTICS_BATCH_MAX_EVENTS }, () => ({ type: "page_view" }));
    expect(analyticsBatchSchema.safeParse(batch({ events: under })).success).toBe(true);
    expect(analyticsBatchSchema.safeParse(batch({ events: [...under, { type: "page_view" }] })).success).toBe(
      false,
    );
    expect(analyticsBatchSchema.safeParse(batch({ events: [] })).success).toBe(false);
  });

  it("requires identifiers to be random, not chosen", () => {
    expect(analyticsBatchSchema.safeParse(batch({ sessionId: "session-1" })).success).toBe(false);
    expect(analyticsBatchSchema.safeParse(batch({ batchId: "" })).success).toBe(false);
  });

  it("requires a path that could be a route", () => {
    expect(analyticsBatchSchema.safeParse(batch({ path: "about" })).success).toBe(false);
    expect(analyticsBatchSchema.safeParse(batch({ path: "/".padEnd(3000, "a") })).success).toBe(false);
  });

  it("treats the version as an optional hint", () => {
    expect(analyticsBatchSchema.safeParse(batch({ versionId: "6a7b46cb9fbee814029888d4" })).success).toBe(true);
    // Not a Mongo id, so it cannot address a document even before the server checks.
    expect(analyticsBatchSchema.safeParse(batch({ versionId: "../../etc/passwd" })).success).toBe(false);
  });
});

describe("event bounds", () => {
  it("clamps a claim of engaged time to something a heartbeat could produce", () => {
    const ok = { type: "engagement_heartbeat", engagedMs: ENGAGEMENT.heartbeatMs };
    const absurd = { type: "engagement_heartbeat", engagedMs: 60 * 60 * 1000 };

    expect(analyticsEventSchema.safeParse(ok).success).toBe(true);
    expect(analyticsEventSchema.safeParse(absurd).success).toBe(false);
  });

  it("accepts only the five scroll depths", () => {
    expect(analyticsEventSchema.safeParse({ type: "scroll_depth", percent: 75 }).success).toBe(true);
    expect(analyticsEventSchema.safeParse({ type: "scroll_depth", percent: 76 }).success).toBe(false);
  });

  it("keeps click coordinates inside the page", () => {
    expect(analyticsEventSchema.safeParse({ type: "page_region_click", x: 0.5, y: 0.5 }).success).toBe(true);
    expect(analyticsEventSchema.safeParse({ type: "page_region_click", x: 1.5, y: 0.5 }).success).toBe(false);
    expect(analyticsEventSchema.safeParse({ type: "page_region_click", x: -0.1, y: 0 }).success).toBe(false);
  });

  it("has no event that could carry visitor content", () => {
    // Every event is either a counter, an identifier the site itself assigned, or a coordinate.
    // Nothing accepts free text, so there is no field a form value or a selection could arrive in.
    const freeText = [
      { type: "element_click", elementId: "a", text: "user@example.com" },
      { type: "page_view", title: "Order #1234" },
      { type: "page_leave", engagedMs: 1, referrer: "https://mail.example.com/inbox/9" },
    ];

    for (const event of freeText) expect(analyticsEventSchema.safeParse(event).success).toBe(false);
  });
});

describe("traffic sources", () => {
  it("keeps a host and refuses a path", () => {
    const source = { kind: "external", host: "news.example.com" };
    expect(analyticsBatchSchema.safeParse(batch({ source })).success).toBe(true);

    const withPath = { kind: "external", host: "news.example.com", path: "/private/thread/9" };
    expect(analyticsBatchSchema.safeParse(batch({ source: withPath })).success).toBe(false);
  });

  it("accepts only the recognised campaign keys", () => {
    const campaign = { kind: "campaign", campaign: { utm_source: "newsletter", utm_medium: "email" } };
    expect(analyticsBatchSchema.safeParse(batch({ source: campaign })).success).toBe(true);

    const smuggled = { kind: "campaign", campaign: { utm_source: "n", session_token: "abc" } };
    expect(analyticsBatchSchema.safeParse(batch({ source: smuggled })).success).toBe(false);
  });

  it("labels every source kind without inventing a name", () => {
    expect(sourceLabel({ kind: "direct" })).toBe("direct");
    expect(sourceLabel({ kind: "external", host: "news.example.com" })).toBe("news.example.com");
    expect(sourceLabel({ kind: "campaign", campaign: { utm_source: "newsletter" } })).toBe("newsletter");
    expect(sourceLabel({ kind: "campaign" })).toBe("campaign");
  });
});

describe("engagement rules", () => {
  const session = (overrides: Partial<{ engagedMs: number; pageViews: number; interactions: number }> = {}) => ({
    engagedMs: 0,
    pageViews: 1,
    interactions: 0,
    ...overrides,
  });

  it("counts ten seconds, a second page, or one interaction as engagement", () => {
    expect(isEngagedSession(session({ engagedMs: 10_000 }))).toBe(true);
    expect(isEngagedSession(session({ pageViews: 2 }))).toBe(true);
    expect(isEngagedSession(session({ interactions: 1 }))).toBe(true);
    expect(isEngagedSession(session({ engagedMs: 9_999 }))).toBe(false);
  });

  it("makes bounce the exact complement of engagement for a single page view", () => {
    // The two definitions have to be each other's negation, or a dashboard can report a session as
    // both engaged and bounced and no one will be able to explain the total.
    const cases = [
      session(),
      session({ engagedMs: 9_999 }),
      session({ engagedMs: 10_000 }),
      session({ interactions: 1 }),
      session({ pageViews: 2 }),
    ];

    for (const candidate of cases) {
      if (candidate.pageViews <= 1) {
        expect(isBounce(candidate)).toBe(!isEngagedSession(candidate));
      } else {
        expect(isBounce(candidate)).toBe(false);
      }
    }
  });
});

describe("Web Vitals", () => {
  it("rates against the published thresholds", () => {
    expect(rateWebVital("LCP", 2500)).toBe("good");
    expect(rateWebVital("LCP", 2501)).toBe("needs-improvement");
    expect(rateWebVital("LCP", 4001)).toBe("poor");
    expect(rateWebVital("CLS", 0.1)).toBe("good");
    expect(rateWebVital("CLS", 0.3)).toBe("poor");
  });

  it("places both thresholds exactly on bucket edges", () => {
    // This is what makes a histogram honest: no bucket can straddle a threshold, so the rating read
    // from the distribution is exact even though the value is only known to a bucket width.
    for (const metric of WEB_VITALS) {
      const edges = webVitalBucketEdges(metric);
      expect(edges).toContain(WEB_VITAL_THRESHOLDS[metric].good);
      expect(edges).toContain(WEB_VITAL_THRESHOLDS[metric].poor);
    }
  });

  it("keeps edges sorted, so a cumulative read is meaningful", () => {
    for (const metric of WEB_VITALS) {
      const edges = webVitalBucketEdges(metric);
      expect([...edges].sort((a, b) => a - b)).toEqual(edges);
    }
  });

  it("puts a sample in a bucket whose rating matches the sample's own", () => {
    for (const metric of WEB_VITALS) {
      const { good, poor } = WEB_VITAL_THRESHOLDS[metric];
      const edges = webVitalBucketEdges(metric);

      for (const value of [0, good / 2, good, (good + poor) / 2, poor, poor * 3]) {
        const bucket = webVitalBucket(metric, value);
        const representative = edges[bucket] ?? poor * 4;
        expect(rateWebVital(metric, representative)).toBe(rateWebVital(metric, value));
      }
    }
  });

  it("puts an absurd sample in the overflow rather than losing it", () => {
    expect(webVitalBucket("LCP", 500_000)).toBe(webVitalBucketEdges("LCP").length);
  });
});

describe("settings", () => {
  it("collects nothing until an owner decides otherwise", () => {
    expect(DEFAULT_ANALYTICS_SETTINGS.enabled).toBe(false);
    expect(DEFAULT_ANALYTICS_SETTINGS.consentRequired).toBe(true);
    expect(DEFAULT_ANALYTICS_SETTINGS.honorPrivacySignals).toBe(true);
    expect(analyticsSettingsSchema.safeParse(DEFAULT_ANALYTICS_SETTINGS).success).toBe(true);
  });

  it("accepts only retention periods the platform can honour", () => {
    expect(analyticsSettingsSchema.safeParse({ ...DEFAULT_ANALYTICS_SETTINGS, retentionDays: 90 }).success).toBe(
      true,
    );
    expect(
      analyticsSettingsSchema.safeParse({ ...DEFAULT_ANALYTICS_SETTINGS, retentionDays: 3650 }).success,
    ).toBe(false);
  });

  it("bounds the sample rate to a fraction", () => {
    expect(analyticsSettingsSchema.safeParse({ ...DEFAULT_ANALYTICS_SETTINGS, sampleRate: 2 }).success).toBe(
      false,
    );
  });
});

describe("heatmap filters", () => {
  it("requires exactly one page, version and device", () => {
    const filter = { mode: "click", pageId: "p1", versionId: "6a7b46cb9fbee814029888d4", device: "desktop" };
    expect(heatmapFilterSchema.safeParse(filter).success).toBe(true);

    for (const missing of ["pageId", "versionId", "device"]) {
      const partial: Record<string, unknown> = { ...filter };
      delete partial[missing];
      expect(heatmapFilterSchema.safeParse(partial).success, `${missing} was optional`).toBe(false);
    }
  });
});
