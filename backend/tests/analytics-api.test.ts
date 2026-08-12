import { DEFAULT_ANALYTICS_SETTINGS, WEB_VITAL_MIN_SAMPLES, type AnalyticsBatch } from "@websitebuilder/shared";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { createSeededWorkspaceResolver } from "../src/middleware/workspace";
import { aggregateBatch, type AnalyticsIdentity } from "../src/modules/analytics/aggregate";
import { AnalyticsQueries } from "../src/modules/analytics/queries";
import { AnalyticsRepository, ensureAnalyticsIndexes } from "../src/modules/analytics/repository";
import { createAnalyticsRouter } from "../src/modules/analytics/routes";
import type { WorkspaceContext } from "../src/modules/projects/repository";
import { testEnv, testLogger } from "./helpers";
import { startTestDatabase, type TestDatabase } from "./mongo";

const WORKSPACE = "workspace-a";
const OTHER = "workspace-b";
const PROJECT = "project-a";
const base = `/api/v1/workspaces/${WORKSPACE}/projects/${PROJECT}/analytics`;

let database: TestDatabase;
let app: Express;
let repository: AnalyticsRepository;

const A: WorkspaceContext = { workspaceId: WORKSPACE, userId: "user-a" };
const B: WorkspaceContext = { workspaceId: OTHER, userId: "user-b" };

const PATHS = new Map([
  ["page-home", "/"],
  ["page-about", "/about"],
]);

const identity = (overrides: Partial<AnalyticsIdentity> = {}): AnalyticsIdentity => ({
  workspaceId: WORKSPACE,
  projectId: PROJECT,
  pageId: "page-home",
  versionId: "6a7b46cb9fbee814029888d4",
  host: "site.example.test",
  receivedAt: new Date(),
  ...overrides,
});

let counter = 0;
const batch = (events: AnalyticsBatch["events"], overrides: Partial<AnalyticsBatch> = {}): AnalyticsBatch => {
  counter += 1;
  const hex = String(counter).padStart(4, "0");
  return {
    schemaVersion: 1,
    batchId: `3f1a1c5e-6b2d-4a7f-9c11-2b0f6a8d${hex}`,
    sessionId: `8d4e51aa-6b2d-4a7f-9c11-2b0f6a8d${hex}`,
    pageViewId: `8d4e51bb-6b2d-4a7f-9c11-2b0f6a8d${hex}`,
    sentAt: new Date().toISOString(),
    path: "/",
    device: "desktop",
    source: { kind: "direct" },
    events,
    ...overrides,
  };
};

const ingest = (who: AnalyticsIdentity, events: AnalyticsBatch["events"], overrides: Partial<AnalyticsBatch> = {}) =>
  repository.apply(aggregateBatch(who, batch(events, overrides)));

beforeAll(async () => {
  database = await startTestDatabase();
  repository = new AnalyticsRepository(database.db);

  app = createApp({
    env: testEnv(),
    logger: testLogger(),
    routers: [
      {
        path: "/workspaces/:workspaceId/projects/:projectId/analytics",
        router: createAnalyticsRouter({
          repository,
          queries: new AnalyticsQueries(database.db, async () => PATHS),
          resolveWorkspace: createSeededWorkspaceResolver({ workspaceId: WORKSPACE, userId: "user-a" }),
        }),
      },
    ],
  });
}, 120_000);

afterAll(async () => {
  await database?.stop();
});

beforeEach(async () => {
  await database.clear();
  await ensureAnalyticsIndexes(database.db);
});

describe("settings", () => {
  it("reports the safe default before anyone has configured a site", async () => {
    const response = await request(app).get(`${base}/settings`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(DEFAULT_ANALYTICS_SETTINGS);
  });

  it("saves a change and reads it back", async () => {
    const settings = { ...DEFAULT_ANALYTICS_SETTINGS, enabled: true, consentRequired: false, retentionDays: 30 };

    const saved = await request(app).put(`${base}/settings`).send(settings);
    expect(saved.status).toBe(200);

    const reloaded = await request(app).get(`${base}/settings`);
    expect(reloaded.body.data).toEqual(settings);
  });

  it("refuses settings the platform cannot honour", async () => {
    const response = await request(app)
      .put(`${base}/settings`)
      .send({ ...DEFAULT_ANALYTICS_SETTINGS, retentionDays: 3650 });

    expect(response.status).toBe(400);
    expect((await request(app).get(`${base}/settings`)).body.data.retentionDays).toBe(90);
  });

  it("refuses a settings body carrying a field the contract does not define", async () => {
    const response = await request(app)
      .put(`${base}/settings`)
      .send({ ...DEFAULT_ANALYTICS_SETTINGS, workspaceId: OTHER });

    expect(response.status).toBe(400);
  });
});

describe("overview", () => {
  it("reports both view counts, so the gap between them is visible", async () => {
    await ingest(identity(), [{ type: "page_view" }]);
    // The renderer counts every visitor; the tracker counts the subset that ran it. A dashboard
    // showing only one of these would either hide the floor or claim the subset is the whole.
    await database.db.collection("siteViews").insertOne({
      workspaceId: WORKSPACE,
      projectId: PROJECT,
      path: "/",
      day: new Date(new Date().toISOString().slice(0, 10)),
      views: 5,
    });

    const response = await request(app).get(`${base}/overview?days=7`);

    expect(response.body.data.browserViews).toBe(1);
    expect(response.body.data.serverViews).toBe(5);
  });

  it("classifies sessions by the documented rules", async () => {
    const bouncing = { sessionId: "8d4e51aa-6b2d-4a7f-9c11-2b0f6a8daaaa" };
    const engaged = { sessionId: "8d4e51aa-6b2d-4a7f-9c11-2b0f6a8dbbbb" };

    await ingest(identity(), [{ type: "page_view" }], bouncing);
    await ingest(identity(), [{ type: "page_view" }, { type: "engagement_heartbeat", engagedMs: 15_000 }], engaged);

    const response = await request(app).get(`${base}/overview?days=7`);

    expect(response.body.data.sessions).toBe(2);
    expect(response.body.data.engagedSessions).toBe(1);
    expect(response.body.data.bounces).toBe(1);
  });

  it("fills every day in the window, so an empty day is a zero and not a gap", async () => {
    const response = await request(app).get(`${base}/overview?days=7`);

    expect(response.body.data.byDay).toHaveLength(7);
    expect(response.body.data.byDay.every((day: { sessions: number }) => day.sessions === 0)).toBe(true);
  });

  it("offers no comparison where the window to compare against has expired", async () => {
    // Sessions are kept 90 days, so comparing 90 against the preceding 90 would read an empty
    // window and report a collapse in traffic that never happened.
    const short = await request(app).get(`${base}/overview?days=7`);
    const long = await request(app).get(`${base}/overview?days=90`);

    expect(short.body.data.comparison).not.toBeNull();
    expect(long.body.data.comparison).toBeNull();
  });

  it("refuses a window that is not one of the offered ones", async () => {
    // A range is a scan; an arbitrary number of days is a way to ask a customer's database to read
    // their whole history on every page load.
    expect((await request(app).get(`${base}/overview?days=100000`)).status).toBe(400);
    expect((await request(app).get(`${base}/overview?days=13`)).status).toBe(400);
  });

  it("narrows to one device without touching the others", async () => {
    await ingest(identity(), [{ type: "page_view" }], { device: "mobile" });
    await ingest(identity(), [{ type: "page_view" }], { device: "desktop" });

    const response = await request(app).get(`${base}/overview?days=7&device=mobile`);
    expect(response.body.data.sessions).toBe(1);
  });
});

describe("pages", () => {
  it("names each page by the path it answers on", async () => {
    await ingest(identity({ pageId: "page-about" }), [{ type: "page_view" }]);

    const response = await request(app).get(`${base}/pages?days=7`);

    expect(response.body.data.pages[0]).toMatchObject({ pageId: "page-about", path: "/about", views: 1 });
  });

  it("shows the identifier for a page that no longer exists rather than inventing a path", async () => {
    await ingest(identity({ pageId: "page-deleted" }), [{ type: "page_view" }]);

    const response = await request(app).get(`${base}/pages?days=7`);

    expect(response.body.data.pages[0].path).toBe("page-deleted");
  });

  it("orders by what was read most", async () => {
    await ingest(identity({ pageId: "page-about" }), [{ type: "page_view" }]);
    await ingest(identity(), [{ type: "page_view" }]);
    await ingest(identity(), [{ type: "page_view" }]);

    const response = await request(app).get(`${base}/pages?days=7`);
    expect(response.body.data.pages.map((page: { pageId: string }) => page.pageId)).toEqual([
      "page-home",
      "page-about",
    ]);
  });
});

describe("heatmaps", () => {
  const filter = "pageId=page-home&versionId=6a7b46cb9fbee814029888d4&device=desktop";

  it("returns the cells for one page, one layout and one device", async () => {
    await ingest(identity(), [{ type: "page_region_click", x: 0.5, y: 0.5 }]);

    const response = await request(app).get(`${base}/heatmap?mode=click&${filter}`);

    expect(response.status).toBe(200);
    expect(response.body.data.samples).toBe(1);
    expect(response.body.data.cells).toHaveLength(1);
  });

  it("refuses to draw one when the filter would mix two of anything", async () => {
    // The refusal is the feature. A heatmap across two layouts or two device widths looks
    // authoritative and describes nothing that ever existed.
    for (const query of [
      "mode=click",
      "mode=click&pageId=page-home",
      "mode=click&pageId=page-home&versionId=6a7b46cb9fbee814029888d4",
      `mode=click&${filter}&pageIds=page-home,page-about`,
    ]) {
      expect((await request(app).get(`${base}/heatmap?${query}`)).status, query).toBe(400);
    }
  });

  it("reports its sample size, so a picture from four visits can say so", async () => {
    const response = await request(app).get(`${base}/heatmap?mode=scroll&${filter}`);
    expect(response.body.data.samples).toBe(0);
  });
});

describe("Web Vitals", () => {
  const sample = (metric: "LCP" | "INP", value: number) =>
    ingest(identity(), [{ type: "web_vital", metric, value }]);

  it("reports a sample count but no rating below the threshold", async () => {
    await sample("LCP", 1000);

    const response = await request(app).get(`${base}/vitals?days=30`);
    const lcp = response.body.data.metrics.find((entry: { metric: string }) => entry.metric === "LCP");

    expect(lcp.samples).toBe(1);
    // A green badge earned by one fast load is worse than no badge, because someone stops looking.
    expect(lcp.p75).toBeNull();
    expect(lcp.rating).toBeNull();
    expect(response.body.data.minimumSamples).toBe(WEB_VITAL_MIN_SAMPLES);
  });

  it("rates once there are enough samples to mean something", async () => {
    for (let index = 0; index < WEB_VITAL_MIN_SAMPLES; index += 1) await sample("LCP", 1000);

    const response = await request(app).get(`${base}/vitals?days=30`);
    const lcp = response.body.data.metrics.find((entry: { metric: string }) => entry.metric === "LCP");

    expect(lcp.samples).toBe(WEB_VITAL_MIN_SAMPLES);
    expect(lcp.rating).toBe("good");
  });

  it("places the rating on the right side of a threshold", async () => {
    // The property the histogram exists to preserve: bucket edges sit exactly on the thresholds, so
    // a distribution just past one is rated as past it.
    for (let index = 0; index < WEB_VITAL_MIN_SAMPLES; index += 1) await sample("LCP", 4500);

    const response = await request(app).get(`${base}/vitals?days=30`);
    const lcp = response.body.data.metrics.find((entry: { metric: string }) => entry.metric === "LCP");

    expect(lcp.rating).toBe("poor");
  });

  it("reports nothing at all for a metric no browser could measure", async () => {
    const response = await request(app).get(`${base}/vitals?days=30`);
    // Absent, not zero. Zero is a measurement.
    expect(response.body.data.metrics).toEqual([]);
  });
});

describe("export", () => {
  it("downloads the aggregates as a spreadsheet", async () => {
    await ingest(identity(), [{ type: "page_view" }]);

    const response = await request(app).get(`${base}/export.csv?days=7`);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.headers["content-disposition"]).toContain("attachment");
    expect(response.headers["cache-control"]).toBe("no-store");
    // Every field is quoted by the shared writer, which is what makes a leading `=` inert.
    expect(response.text).toContain('"path","views","clicks"');
  });

  it("neutralises a path a spreadsheet would execute", async () => {
    // Page paths and referrer hosts are untrusted strings, and a leading `=` in a CSV cell is a
    // formula the moment someone opens the file.
    await ingest(identity({ pageId: "=HYPERLINK(\"http://evil.test\")" }), [{ type: "page_view" }]);

    const response = await request(app).get(`${base}/export.csv?days=7`);

    expect(response.text).not.toMatch(/^=HYPERLINK/m);
  });
});

describe("tenant isolation", () => {
  it("never reads another workspace's measurements", async () => {
    await ingest(identity({ workspaceId: OTHER }), [{ type: "page_view" }]);

    const response = await request(app).get(`${base}/overview?days=7`);

    expect(response.body.data.sessions).toBe(0);
    expect(response.body.data.browserViews).toBe(0);
    expect(B.workspaceId).toBe(OTHER);
  });

  it("deletes only what belongs to the project it was asked for", async () => {
    await ingest(identity(), [{ type: "page_view" }, { type: "page_region_click", x: 0.5, y: 0.5 }]);
    await ingest(identity({ projectId: "project-b" }), [{ type: "page_view" }]);
    await ingest(identity({ workspaceId: OTHER }), [{ type: "page_view" }]);

    const response = await request(app).delete(`${base}/data`);

    expect(response.status).toBe(200);
    expect(response.body.data.deleted.daily).toBe(1);
    expect(await database.db.collection("analyticsDaily").countDocuments({})).toBe(2);
  });

  it("deletes the server-counted views too", async () => {
    // A customer asking to delete their analytics means all of it, not the part that needed no
    // consent to collect.
    await database.db.collection("siteViews").insertOne({
      workspaceId: WORKSPACE,
      projectId: PROJECT,
      path: "/",
      day: new Date(),
      views: 3,
    });

    await request(app).delete(`${base}/data`);

    expect(await database.db.collection("siteViews").countDocuments({})).toBe(0);
    expect(A.workspaceId).toBe(WORKSPACE);
  });
});
