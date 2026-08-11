import { z } from "zod";

/**
 * The analytics contract: what a published page may report, what a dashboard may ask for, and what
 * every metric means.
 *
 * One module, imported by the tracker, the renderer that receives events, the API that queries them
 * and the dashboard that displays them — so those four cannot disagree about a field name, a bound
 * or a threshold.
 *
 * Two properties are load-bearing and easy to lose in a refactor:
 *
 * The envelope contains **no tenant identity**. There is no `workspaceId`, no `projectId` and no
 * `pageId`, because the server derives all three from the hostname the request arrived on and the
 * published route manifest. A field that does not exist cannot be forged.
 *
 * Every bound is a `.strict()` schema with an explicit maximum. Unbounded strings and unclamped
 * numbers arriving from a stranger's browser are how an analytics endpoint becomes a way to write
 * arbitrary data into someone else's workspace.
 */

/** Devices are three coarse buckets, chosen at the same breakpoints the builder designs against. */
export const DEVICE_CATEGORIES = ["desktop", "tablet", "mobile"] as const;
export type DeviceCategory = (typeof DEVICE_CATEGORIES)[number];

/**
 * Scroll is reported as one of five depths rather than a percentage.
 *
 * A percentage would be a hundred columns of near-identical numbers and a way to tell one visitor
 * from another on a quiet site. These five are the ones anyone acts on: did they see the fold, the
 * middle, the call to action, the footer.
 */
export const SCROLL_DEPTH_BUCKETS = [25, 50, 75, 90, 100] as const;
export type ScrollDepthBucket = (typeof SCROLL_DEPTH_BUCKETS)[number];

/**
 * The heatmap grid.
 *
 * Coordinates arrive normalised and are stored as a cell index, never as a point. 40 columns is
 * fine enough to tell one button from its neighbour and coarse enough that a single visitor's exact
 * click position is not recoverable from the aggregate.
 */
export const CLICK_GRID_COLUMNS = 40;
export const CLICK_GRID_ROWS = 60;

/** Web Vitals collected from real visitors. */
export const WEB_VITALS = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;
export type WebVital = (typeof WEB_VITALS)[number];

/**
 * Current Core Web Vitals thresholds: at or below `good` is good, above `poor` is poor, between is
 * needs-improvement. Milliseconds except CLS, which is unitless.
 *
 * These are Google's published thresholds rather than ours. When they move, this is the one place
 * that changes, and every rating in the product moves with it.
 */
export const WEB_VITAL_THRESHOLDS: Record<WebVital, { good: number; poor: number }> = {
  LCP: { good: 2500, poor: 4000 },
  INP: { good: 200, poor: 500 },
  CLS: { good: 0.1, poor: 0.25 },
  FCP: { good: 1800, poor: 3000 },
  TTFB: { good: 800, poor: 1800 },
};

export const WEB_VITAL_RATINGS = ["good", "needs-improvement", "poor"] as const;
export type WebVitalRating = (typeof WEB_VITAL_RATINGS)[number];

export function rateWebVital(metric: WebVital, value: number): WebVitalRating {
  const { good, poor } = WEB_VITAL_THRESHOLDS[metric];
  if (value <= good) return "good";
  return value <= poor ? "needs-improvement" : "poor";
}

/**
 * Histogram edges for one metric.
 *
 * Samples are counted into buckets rather than stored, so storage does not grow with traffic. The
 * cost is that a percentile is known to one bucket width — which would matter if the product
 * displayed the p75 *value* as a precise number, and does not, because what it displays is the p75
 * *rating*. The two threshold values are therefore edges, exactly: a distribution can never
 * straddle a threshold inside one bucket, so the rating is exact even though the value is not.
 */
export function webVitalBucketEdges(metric: WebVital): number[] {
  const { good, poor } = WEB_VITAL_THRESHOLDS[metric];
  const spread = (from: number, to: number, steps: number) =>
    Array.from({ length: steps }, (_, index) => from + ((to - from) * (index + 1)) / (steps + 1));

  return [...spread(0, good, 9), good, ...spread(good, poor, 9), poor, poor * 2, poor * 4];
}

/** The bucket index a sample falls into: the first edge it does not exceed, else the overflow. */
export function webVitalBucket(metric: WebVital, value: number): number {
  const edges = webVitalBucketEdges(metric);
  const index = edges.findIndex((edge) => value <= edge);
  return index === -1 ? edges.length : index;
}

/**
 * Session and engagement rules.
 *
 * Written down once, here, because they are the difference between two products' "bounce rate"
 * disagreeing by a factor of two, and because the dashboard must be able to explain every number it
 * shows in the same words the code uses.
 */
export const ENGAGEMENT = {
  /** Inactivity that ends a session. A visitor returning later starts a new one. */
  sessionTimeoutMs: 30 * 60 * 1000,
  /** Engaged time at which a session stops being a bounce. */
  engagedMsThreshold: 10_000,
  /** A section counts as seen at half visible for a continuous second. */
  sectionVisibleRatio: 0.5,
  sectionVisibleMs: 1000,
  /** Heartbeat cadence, and therefore the maximum engaged time a single event may claim. */
  heartbeatMs: 15_000,
  /** Idle time that pauses engagement accumulation without ending the session. */
  idleMs: 60_000,
} as const;

export function isEngagedSession(session: { engagedMs: number; pageViews: number; interactions: number }): boolean {
  return (
    session.engagedMs >= ENGAGEMENT.engagedMsThreshold || session.pageViews >= 2 || session.interactions >= 1
  );
}

export function isBounce(session: { engagedMs: number; pageViews: number; interactions: number }): boolean {
  return (
    session.pageViews <= 1 && session.engagedMs < ENGAGEMENT.engagedMsThreshold && session.interactions === 0
  );
}

/**
 * Traffic sources.
 *
 * Only the referrer's host is kept, never its path: the path is the page someone was reading before
 * they arrived, which is their business. Campaign parameters are an explicit allowlist — everything
 * else in a query string is discarded before storage, because query strings carry session tokens,
 * email addresses and order numbers far more often than they carry analytics.
 */
export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;
export type UtmKey = (typeof UTM_KEYS)[number];

export const analyticsSourceSchema = z
  .object({
    kind: z.enum(["direct", "internal", "external", "campaign"]),
    /** Host only, lowercased, never a path or a query. Absent for direct traffic. */
    host: z.string().max(253).optional(),
    campaign: z
      .object({
        utm_source: z.string().max(80).optional(),
        utm_medium: z.string().max(80).optional(),
        utm_campaign: z.string().max(80).optional(),
        utm_term: z.string().max(80).optional(),
        utm_content: z.string().max(80).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type AnalyticsSource = z.infer<typeof analyticsSourceSchema>;

/** A label a source breakdown groups by. Stable and low-cardinality by construction. */
export function sourceLabel(source: AnalyticsSource): string {
  if (source.kind === "campaign") return source.campaign?.utm_source ?? "campaign";
  if (source.kind === "external") return source.host ?? "external";
  return source.kind;
}

const normalisedCoordinate = z.number().min(0).max(1);
const identifier = z.string().min(1).max(64);

/**
 * Events.
 *
 * A discriminated union rather than a bag with optional fields, so a malformed event is rejected at
 * the boundary instead of producing a row with the wrong shape. `form_success` from the original
 * specification is deliberately absent: no form element exists in the builder, so no published page
 * can contain one and the event could never fire. Adding it now would put an unreachable branch in
 * the ingestion path and a permanently zero metric on the dashboard.
 */
export const analyticsEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("page_view") }).strict(),
  z
    .object({
      type: z.literal("engagement_heartbeat"),
      // Bounded by the heartbeat interval with headroom for a delayed timer. A client claiming an
      // hour of engagement in one event is either broken or lying.
      engagedMs: z.number().int().min(0).max(ENGAGEMENT.heartbeatMs * 4),
    })
    .strict(),
  z
    .object({
      type: z.literal("page_leave"),
      engagedMs: z.number().int().min(0).max(ENGAGEMENT.heartbeatMs * 4),
    })
    .strict(),
  z.object({ type: z.literal("scroll_depth"), percent: z.union([z.literal(25), z.literal(50), z.literal(75), z.literal(90), z.literal(100)]) }).strict(),
  z
    .object({
      type: z.literal("section_visibility"),
      sectionId: identifier,
      visibleMs: z.number().int().min(0).max(ENGAGEMENT.heartbeatMs * 4),
    })
    .strict(),
  z.object({ type: z.literal("element_click"), elementId: identifier }).strict(),
  z
    .object({ type: z.literal("page_region_click"), x: normalisedCoordinate, y: normalisedCoordinate })
    .strict(),
  z
    .object({
      type: z.literal("web_vital"),
      metric: z.enum(WEB_VITALS),
      // Upper bound is generous but finite: a page that took eleven minutes to paint tells us
      // nothing a clamp would not, and an unbounded number is a way to poison an average.
      value: z.number().min(0).max(600_000),
    })
    .strict(),
]);

export type AnalyticsEvent = z.infer<typeof analyticsEventSchema>;

/** Maximum events in one batch, and the maximum decoded body the endpoint accepts. */
export const ANALYTICS_BATCH_MAX_EVENTS = 50;
export const ANALYTICS_BATCH_MAX_BYTES = 64 * 1024;

const uuid = z.string().uuid();

export const analyticsBatchSchema = z
  .object({
    schemaVersion: z.literal(1),
    /** Deduplication key. A retried batch keeps its id, so a retry cannot double-count. */
    batchId: uuid,
    sessionId: uuid,
    pageViewId: uuid,
    /**
     * Orders events inside this batch and is never stored. Persisting a client clock would mean
     * defending a skew window against a value the client chooses; the server's receipt time has no
     * such problem.
     */
    sentAt: z.string().datetime(),
    /**
     * The path the visitor is on. Resolved server-side against the published route manifest and
     * discarded if it is not a published route — a request path is chosen by the caller, and
     * counting it directly would let anyone create unbounded rows in someone else's workspace.
     */
    path: z.string().startsWith("/").max(2048),
    /**
     * Which published version rendered this page. A hint, not a claim: the active pointer may have
     * moved after the page loaded, and attributing clicks to a layout the visitor never saw is the
     * stale-overlay problem heatmaps exist to avoid. The server accepts it only if that version
     * exists, and falls back to the active one.
     */
    versionId: z.string().length(24).optional(),
    device: z.enum(DEVICE_CATEGORIES),
    source: analyticsSourceSchema,
    events: z.array(analyticsEventSchema).min(1).max(ANALYTICS_BATCH_MAX_EVENTS),
  })
  .strict();

export type AnalyticsBatch = z.infer<typeof analyticsBatchSchema>;

/**
 * Per-site settings.
 *
 * Disabled by default, and that default is not a formality: sites published before this feature
 * existed disclosed no measurement to their visitors, and turning collection on for them without
 * their owner deciding to would be making a promise on someone else's behalf.
 */
export const ANALYTICS_COLLECTION_CATEGORIES = ["traffic", "interaction", "performance"] as const;
export type AnalyticsCollectionCategory = (typeof ANALYTICS_COLLECTION_CATEGORIES)[number];

export const ANALYTICS_RETENTION_CHOICES = [30, 90, 180, 400] as const;

export const analyticsSettingsSchema = z
  .object({
    enabled: z.boolean(),
    /** When true, nothing is collected until the visitor accepts. */
    consentRequired: z.boolean(),
    categories: z.array(z.enum(ANALYTICS_COLLECTION_CATEGORIES)),
    retentionDays: z.union([z.literal(30), z.literal(90), z.literal(180), z.literal(400)]),
    /** Shown beside the consent prompt. Validated as a link elsewhere; stored as given. */
    privacyPolicyUrl: z.string().max(2048),
    /** Honour Global Privacy Control and Do Not Track headers as a decline. */
    honorPrivacySignals: z.boolean(),
    /** Fraction of sessions measured. Whole sessions, never individual events. */
    sampleRate: z.number().min(0).max(1),
  })
  .strict();

export type AnalyticsSettings = z.infer<typeof analyticsSettingsSchema>;

export const DEFAULT_ANALYTICS_SETTINGS: AnalyticsSettings = {
  enabled: false,
  consentRequired: true,
  categories: ["traffic", "interaction", "performance"],
  retentionDays: 90,
  privacyPolicyUrl: "",
  honorPrivacySignals: true,
  sampleRate: 1,
};

/**
 * Dashboard filters.
 *
 * A closed set of windows rather than an arbitrary number of days: a range is a scan over an
 * indexed collection, and `?days=100000` should not be a way to ask a customer's database to read
 * their entire history on every page load.
 */
export const ANALYTICS_WINDOWS = [1, 7, 30, 90] as const;
export type AnalyticsWindow = (typeof ANALYTICS_WINDOWS)[number];

/**
 * Sessions expire at 90 days, so a comparison against the preceding equal period has nothing to
 * read beyond half of that. Comparisons are offered only where the data exists.
 */
export const ANALYTICS_MAX_COMPARISON_DAYS = 45;

export const analyticsFilterSchema = z
  .object({
    days: z.union([z.literal(1), z.literal(7), z.literal(30), z.literal(90)]).optional(),
    /** Page identifiers. Absent means every page. */
    pageIds: z.array(identifier).max(50).optional(),
    device: z.enum(DEVICE_CATEGORIES).optional(),
    source: z.string().max(120).optional(),
    host: z.string().max(253).optional(),
    /** Heatmaps only. Traffic collections carry no version. */
    versionId: z.string().length(24).optional(),
    compare: z.boolean().optional(),
  })
  .strict();

export type AnalyticsFilter = z.infer<typeof analyticsFilterSchema>;

export const HEATMAP_MODES = ["click", "scroll", "attention"] as const;
export type HeatmapMode = (typeof HEATMAP_MODES)[number];

/**
 * A heatmap needs exactly one page, one version and one device.
 *
 * Overlaying two layouts, or a phone's clicks on a desktop rendering, produces a picture that looks
 * authoritative and means nothing. The UI asks the reader to narrow rather than drawing it.
 */
export const heatmapFilterSchema = z
  .object({
    mode: z.enum(HEATMAP_MODES),
    pageId: identifier,
    versionId: z.string().length(24),
    device: z.enum(DEVICE_CATEGORIES),
  })
  .strict();

export type HeatmapFilter = z.infer<typeof heatmapFilterSchema>;

/**
 * The minimum samples before a Web Vital is rated.
 *
 * Below this the p75 of a handful of visits is noise, and a green badge earned by three fast loads
 * is worse than no badge, because someone will stop looking.
 */
export const WEB_VITAL_MIN_SAMPLES = 50;

/**
 * Consent copy for a published site.
 *
 * Deliberately outside the application's translation catalogues. Those are loaded by i18next in the
 * dashboard; a published page loads nothing, and its language is the one its owner chose for the
 * site, not the one the visitor's dashboard is in. Both locales are defined here together so
 * neither can be added without the other.
 */
export const CONSENT_COPY = {
  "pt-BR": {
    message: "Este site mede acessos anônimos para entender o que as pessoas procuram.",
    accept: "Aceitar",
    decline: "Recusar",
    policy: "Política de privacidade",
  },
  "en-US": {
    message: "This site measures anonymous visits to understand what people are looking for.",
    accept: "Accept",
    decline: "Decline",
    policy: "Privacy policy",
  },
} as const;

export type ConsentCopy = { message: string; accept: string; decline: string; policy: string };

/** The copy for a site's locale, falling back to English for any locale not translated. */
export function consentCopyFor(locale: string): ConsentCopy {
  return locale.toLowerCase().startsWith("pt") ? CONSENT_COPY["pt-BR"] : CONSENT_COPY["en-US"];
}
