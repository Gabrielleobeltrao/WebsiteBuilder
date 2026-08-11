import {
  analyticsFilterSchema,
  heatmapFilterSchema,
  isBounce,
  isEngagedSession,
  rateWebVital,
  webVitalBucketEdges,
  WEB_VITALS,
  WEB_VITAL_MIN_SAMPLES,
  type AnalyticsFilter,
  type DeviceCategory,
  type HeatmapFilter,
  type WebVital,
  type WebVitalRating,
} from "@websitebuilder/shared";
import type { Collection, Db, Filter } from "mongodb";

import { ApiProblem } from "../../middleware/errors";
import type { WorkspaceContext } from "../projects/repository";
import {
  ANALYTICS_COLLECTIONS,
  utcDay,
  type BinDocument,
  type DailyDocument,
  type SessionDocument,
  type SiteViewDocument,
  type VitalDocument,
} from "./repository";

/**
 * Reading what was measured.
 *
 * Two rules run through everything here. Every filter starts with the workspace and the project, so
 * a query cannot be written that reaches another tenant even by accident. And nothing is inferred:
 * where a number cannot be computed honestly — too few samples, a window with no data, a filter
 * combination that would draw two layouts on one picture — the response says so instead of
 * returning a shape the dashboard would render as zero.
 */

export type AnalyticsOverview = {
  days: number;
  from: string;
  to: string;
  /** Counted by the renderer for every visitor, whatever their browser did. */
  serverViews: number;
  /** Counted by the tracker, so a subset. Their ratio is the measurement coverage. */
  browserViews: number;
  sessions: number;
  engagedSessions: number;
  bounces: number;
  engagedMs: number;
  clicks: number;
  byDay: Array<{ day: string; sessions: number; views: number }>;
  byDevice: Array<{ device: string; sessions: number }>;
  bySource: Array<{ source: string; sessions: number }>;
  byHost: Array<{ host: string; sessions: number }>;
  /** The preceding window of equal length, when one is short enough to still hold data. */
  comparison: { sessions: number; browserViews: number } | null;
};

export type AnalyticsPages = {
  pages: Array<{
    pageId: string;
    path: string;
    views: number;
    clicks: number;
    /** Sessions that reached each depth, keyed by percentage. */
    scroll: Record<string, number>;
  }>;
};

export type AnalyticsHeatmap = {
  mode: HeatmapFilter["mode"];
  pageId: string;
  versionId: string;
  device: DeviceCategory;
  /** Sample size, so a picture drawn from four visits can say so. */
  samples: number;
  cells: Array<{ key: string; count: number; ms?: number }>;
};

export type AnalyticsVitals = {
  metrics: Array<{
    metric: WebVital;
    device: DeviceCategory;
    samples: number;
    /** Absent below the sample threshold: a rating from a handful of visits is noise with a badge. */
    p75: number | null;
    rating: WebVitalRating | null;
  }>;
  minimumSamples: number;
};

/** The parts of a published version a heatmap needs. */
export type VersionSnapshot = {
  id: string;
  workspaceId: string;
  version: number;
  createdAt: string;
  document: unknown;
  routes: Array<{ kind: string; statusCode: number; resourceId: string; path: string }>;
};

/** Resolves a page identifier to the path a person recognises. */
export type PathResolver = (context: WorkspaceContext, projectId: string) => Promise<Map<string, string>>;

/** A published layout, and which of its versions still exist to be drawn over. */
export type AnalyticsSnapshot = {
  versionId: string;
  version: number;
  createdAt: string;
  document: unknown;
  pages: Array<{ pageId: string; path: string }>;
};

export class AnalyticsQueries {
  private readonly sessions: Collection<SessionDocument>;
  private readonly daily: Collection<DailyDocument>;
  private readonly bins: Collection<BinDocument>;
  private readonly vitalRows: Collection<VitalDocument>;
  private readonly siteViews: Collection<SiteViewDocument>;

  constructor(
    db: Db,
    /** Page identifiers mean nothing to a reader; the published manifest turns them into paths. */
    private readonly resolvePaths: PathResolver,
    /** Loads one immutable version. Injected so this module keeps no dependency on publishing. */
    private readonly loadVersion: (projectId: string, versionId: string) => Promise<VersionSnapshot | null> = async () =>
      null,
  ) {
    this.sessions = db.collection<SessionDocument>(ANALYTICS_COLLECTIONS.sessions);
    this.daily = db.collection<DailyDocument>(ANALYTICS_COLLECTIONS.daily);
    this.bins = db.collection<BinDocument>(ANALYTICS_COLLECTIONS.bins);
    this.vitalRows = db.collection<VitalDocument>(ANALYTICS_COLLECTIONS.vitals);
    this.siteViews = db.collection<SiteViewDocument>(ANALYTICS_COLLECTIONS.siteViews);
  }

  async overview(context: WorkspaceContext, projectId: string, query: unknown): Promise<AnalyticsOverview> {
    const filter = parseFilter(query);
    const days = filter.days ?? 30;
    const window = windowOf(days);
    const scope = { workspaceId: context.workspaceId, projectId };

    const [sessions, counters, serverViews, previous] = await Promise.all([
      this.sessions.find({ ...scope, startedAt: { $gte: window.from, $lt: window.end } }).toArray(),
      this.dailyRows(scope, window, filter),
      this.serverViews(scope, window),
      // Only where the comparison window still holds data. Sessions expire, and a comparison drawn
      // against an expired window would report a collapse in traffic that never happened.
      days * 2 <= 90
        ? this.sessions
            .find({
              ...scope,
              startedAt: { $gte: windowOf(days, window.from).from, $lt: window.from },
            })
            .toArray()
        : Promise.resolve(null),
    ]);

    const relevant = sessions.filter((session) => matchesSession(session, filter));
    const byDayMap = new Map<string, { sessions: number; views: number }>();
    for (const day of eachDay(window.from, window.to)) byDayMap.set(day, { sessions: 0, views: 0 });

    for (const session of relevant) {
      const key = session.startedAt.toISOString().slice(0, 10);
      const entry = byDayMap.get(key);
      if (entry !== undefined) entry.sessions += 1;
    }
    for (const row of counters) {
      const entry = byDayMap.get(row.day.toISOString().slice(0, 10));
      if (entry !== undefined) entry.views += row.views ?? 0;
    }

    return {
      days,
      from: window.from.toISOString().slice(0, 10),
      to: window.to.toISOString().slice(0, 10),
      serverViews,
      browserViews: counters.reduce((total, row) => total + (row.views ?? 0), 0),
      sessions: relevant.length,
      engagedSessions: relevant.filter((session) => isEngagedSession(session)).length,
      bounces: relevant.filter((session) => isBounce(session)).length,
      engagedMs: relevant.reduce((total, session) => total + session.engagedMs, 0),
      clicks: counters.reduce((total, row) => total + (row.clicks ?? 0), 0),
      byDay: [...byDayMap].map(([day, totals]) => ({ day, ...totals })),
      byDevice: countBy(relevant, (session) => session.device).map(([device, sessions]) => ({ device, sessions })),
      bySource: countBy(relevant, (session) => session.source).map(([source, sessions]) => ({ source, sessions })),
      byHost: countBy(relevant, (session) => session.host).map(([host, sessions]) => ({ host, sessions })),
      comparison:
        previous === null
          ? null
          : {
              sessions: previous.filter((session) => matchesSession(session, filter)).length,
              browserViews: 0,
            },
    };
  }

  async pages(context: WorkspaceContext, projectId: string, query: unknown): Promise<AnalyticsPages> {
    const filter = parseFilter(query);
    const window = windowOf(filter.days ?? 30);
    const scope = { workspaceId: context.workspaceId, projectId };

    const [rows, paths] = await Promise.all([
      this.dailyRows(scope, window, filter),
      this.resolvePaths(context, projectId),
    ]);

    const byPage = new Map<string, { views: number; clicks: number; scroll: Record<string, number> }>();
    for (const row of rows) {
      const entry = byPage.get(row.pageId) ?? { views: 0, clicks: 0, scroll: {} };
      entry.views += row.views ?? 0;
      entry.clicks += row.clicks ?? 0;
      for (const [bucket, count] of Object.entries(row.scroll ?? {})) {
        entry.scroll[bucket] = (entry.scroll[bucket] ?? 0) + count;
      }
      byPage.set(row.pageId, entry);
    }

    return {
      pages: [...byPage]
        .map(([pageId, totals]) => ({
          pageId,
          // A page that was deleted after it was measured keeps its history and loses its name.
          // Showing the identifier is honest; inventing a path would not be.
          path: paths.get(pageId) ?? pageId,
          ...totals,
        }))
        .sort((left, right) => right.views - left.views),
    };
  }

  async heatmap(context: WorkspaceContext, projectId: string, query: unknown): Promise<AnalyticsHeatmap> {
    const parsed = heatmapFilterSchema.safeParse(query);
    if (!parsed.success) {
      // Refusing is the feature. A heatmap over two pages, two layouts or two device widths is a
      // picture that looks authoritative and describes nothing that ever existed.
      throw new ApiProblem("VALIDATION_ERROR", "A heatmap needs exactly one page, one version and one device");
    }

    const filter = parsed.data;
    const kind = filter.mode === "click" ? "click" : filter.mode === "scroll" ? "scroll" : "section";
    const cells = await this.bins
      .find({
        workspaceId: context.workspaceId,
        projectId,
        versionId: filter.versionId,
        pageId: filter.pageId,
        device: filter.device,
        kind,
      })
      .toArray();

    return {
      mode: filter.mode,
      pageId: filter.pageId,
      versionId: filter.versionId,
      device: filter.device,
      samples: cells.reduce((total, cell) => total + cell.count, 0),
      cells: cells.map((cell) => ({ key: cell.key, count: cell.count, ...(cell.ms === undefined ? {} : { ms: cell.ms }) })),
    };
  }

  async vitals(context: WorkspaceContext, projectId: string, query: unknown): Promise<AnalyticsVitals> {
    const filter = parseFilter(query);
    const window = windowOf(filter.days ?? 30);

    const rows = await this.vitalRows
      .find({
        workspaceId: context.workspaceId,
        projectId,
        day: { $gte: window.from, $lte: window.to },
        ...(filter.pageIds === undefined ? {} : { pageId: { $in: filter.pageIds } }),
      })
      .toArray();

    const metrics: AnalyticsVitals["metrics"] = [];
    for (const metric of WEB_VITALS) {
      for (const device of ["desktop", "tablet", "mobile"] as const) {
        const buckets = rows.filter((row) => row.metric === metric && row.device === device);
        const samples = buckets.reduce((total, row) => total + row.count, 0);
        const p75 = samples >= WEB_VITAL_MIN_SAMPLES ? percentileFromBuckets(metric, buckets, 0.75) : null;

        if (samples > 0) {
          metrics.push({
            metric,
            device,
            samples,
            p75,
            // No rating below the threshold. A green badge earned by three fast loads is worse than
            // no badge, because someone stops looking.
            rating: p75 === null ? null : rateWebVital(metric, p75),
          });
        }
      }
    }

    return { metrics, minimumSamples: WEB_VITAL_MIN_SAMPLES };
  }

  /**
   * One immutable version, with the document the dashboard renders to place an overlay.
   *
   * Scoped by workspace before anything is returned. A version whose retention window has passed is
   * gone, and saying so is the honest answer — the alternative would be drawing a customer's old
   * coordinates over a layout that did not produce them.
   */
  async snapshot(context: WorkspaceContext, projectId: string, versionId: string): Promise<AnalyticsSnapshot | null> {
    const version = await this.loadVersion(projectId, versionId);
    if (version === null || version.workspaceId !== context.workspaceId) return null;

    return {
      versionId: version.id,
      version: version.version,
      createdAt: version.createdAt,
      document: version.document,
      pages: version.routes
        .filter((route) => route.kind === "page" && route.statusCode === 200)
        .map((route) => ({ pageId: route.resourceId, path: route.path })),
    };
  }

  private dailyRows(
    scope: { workspaceId: string; projectId: string },
    window: { from: Date; to: Date },
    filter: AnalyticsFilter,
  ): Promise<DailyDocument[]> {
    const query: Filter<DailyDocument> = {
      ...scope,
      day: { $gte: window.from, $lte: window.to },
      ...(filter.pageIds === undefined ? {} : { pageId: { $in: filter.pageIds } }),
      ...(filter.device === undefined ? {} : { device: filter.device }),
      ...(filter.source === undefined ? {} : { source: filter.source }),
    };
    return this.daily.find(query).toArray();
  }

  private async serverViews(
    scope: { workspaceId: string; projectId: string },
    window: { from: Date; to: Date },
  ): Promise<number> {
    const rows = await this.siteViews.find({ ...scope, day: { $gte: window.from, $lte: window.to } }).toArray();
    return rows.reduce((total, row) => total + row.views, 0);
  }
}

function parseFilter(query: unknown): AnalyticsFilter {
  const raw = query as Record<string, unknown>;
  const normalised = {
    ...raw,
    ...(raw["days"] === undefined ? {} : { days: Number(raw["days"]) }),
    ...(raw["pageIds"] === undefined
      ? {}
      : { pageIds: Array.isArray(raw["pageIds"]) ? raw["pageIds"] : String(raw["pageIds"]).split(",") }),
    ...(raw["compare"] === undefined ? {} : { compare: raw["compare"] === "true" || raw["compare"] === true }),
  };

  const parsed = analyticsFilterSchema.safeParse(normalised);
  if (!parsed.success) throw new ApiProblem("VALIDATION_ERROR", "That analytics filter is not valid");
  return parsed.data;
}

/**
 * A window of whole UTC days.
 *
 * Two ends, because the collections are keyed differently. Counter rows carry a `day` that is
 * already a UTC midnight, so they are matched inclusively against `to`. Sessions carry the instant
 * they started, and comparing an instant against today's midnight silently excludes everything that
 * happened today — so they are matched against `end`, which is midnight tomorrow, exclusively.
 */
function windowOf(days: number, endingBefore?: Date): { from: Date; to: Date; end: Date } {
  const to = endingBefore === undefined ? utcDay(new Date()) : new Date(endingBefore.getTime() - 86_400_000);
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  return { from, to, end: new Date(to.getTime() + 86_400_000) };
}

function eachDay(from: Date, to: Date): string[] {
  const days: string[] = [];
  for (let day = new Date(from); day <= to; day = new Date(day.getTime() + 86_400_000)) {
    days.push(day.toISOString().slice(0, 10));
  }
  return days;
}

/** Session filters are applied in memory: the rows are already loaded and bounded by the window. */
function matchesSession(session: SessionDocument, filter: AnalyticsFilter): boolean {
  if (filter.device !== undefined && session.device !== filter.device) return false;
  if (filter.source !== undefined && session.source !== filter.source) return false;
  if (filter.host !== undefined && session.host !== filter.host) return false;
  return true;
}

function countBy<T>(items: T[], key: (item: T) => string): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts].sort((left, right) => right[1] - left[1]);
}

/**
 * A percentile read from a histogram.
 *
 * Returns the upper edge of the bucket the percentile falls in, which is exact for the *rating*
 * because both thresholds are bucket edges, and approximate for the value by at most one bucket
 * width. The alternative — storing every sample to be able to sort them — grows with traffic to
 * answer a question this answers.
 */
function percentileFromBuckets(metric: WebVital, buckets: VitalDocument[], percentile: number): number | null {
  const edges = webVitalBucketEdges(metric);
  const total = buckets.reduce((sum, row) => sum + row.count, 0);
  if (total === 0) return null;

  const counts = new Map(buckets.map((row) => [row.bucket, row.count]));
  const target = total * percentile;

  let seen = 0;
  for (let index = 0; index <= edges.length; index += 1) {
    seen += counts.get(index) ?? 0;
    if (seen >= target) return edges[index] ?? (edges.at(-1) ?? 0);
  }
  return edges.at(-1) ?? null;
}
