import {
  DEFAULT_ANALYTICS_SETTINGS,
  type AnalyticsSettings,
  type DeviceCategory,
  type WebVital,
} from "@websitebuilder/shared";
import type { Collection, Db } from "mongodb";

import type { WorkspaceContext } from "../projects/repository";
import type { AnalyticsWrites } from "./aggregate";

/**
 * Traffic measurement for published sites.
 *
 * Counted on the server, because published pages ship no JavaScript: the renderer's policy is
 * `script-src 'none'`, and a tracking beacon would mean weakening it for every visitor of every
 * customer. Server-side counting is also the only kind that cannot be turned off by a blocker.
 *
 * Two consequences are worth stating rather than discovering later. A shared cache in front of the
 * renderer serves repeat requests without reaching this process, so counts are a floor, not a
 * census. And nothing here identifies a person: no address, no agent string, no cookie — a row is
 * one page on one day with a number, which is why it needs no consent banner and no retention
 * argument beyond the one below.
 *
 * Rows are counters, not events. A site with 20 pages costs 20 rows a day whether it serves ten
 * requests or ten million, so storage follows the customer's page count and never their traffic.
 */
export const ANALYTICS_COLLECTIONS = {
  /** Server-counted views. Always on, needs no consent, and survives every kind of blocking. */
  siteViews: "siteViews",
  /** One row per anonymous session, mutated only by commutative operators. */
  sessions: "analyticsSessions",
  /** Daily counters per page, device and source. */
  daily: "analyticsDaily",
  /** Spatial data, and the only collection tied to a published version. */
  bins: "analyticsBins",
  /** Web Vitals as histogram buckets rather than samples. */
  vitals: "analyticsVitals",
  /** Batch identifiers, so a retried beacon cannot be counted twice. */
  batches: "analyticsBatches",
  /** Per-site collection settings. */
  settings: "analyticsSettings",
} as const;

/** Just over a year, so a dashboard can always show the same month last year. */
const RETENTION_DAYS = 400;

/**
 * Sessions are kept for a quarter and no longer.
 *
 * They are the only analytics rows that grow with traffic rather than with the shape of the site,
 * and the only ones that describe a single visit rather than a total. Ninety days answers every
 * question the product asks of them; keeping a year of individual visits to answer none of them
 * would be collecting for its own sake.
 */
const SESSION_RETENTION_DAYS = 90;

/** Long enough that a retried beacon is still recognised, short enough to stay small. */
const BATCH_DEDUP_RETENTION_HOURS = 2;

export type SessionDocument = {
  workspaceId: string;
  projectId: string;
  sessionId: string;
  startedAt: Date;
  lastEventAt: Date;
  day: Date;
  pageViews: number;
  engagedMs: number;
  interactions: number;
  device: DeviceCategory;
  source: string;
  host: string;
  entryPageId: string;
};

export type DailyDocument = {
  workspaceId: string;
  projectId: string;
  day: Date;
  pageId: string;
  device: DeviceCategory;
  source: string;
  views: number;
  clicks: number;
  /** Reached-session counts keyed by depth bucket. */
  scroll: Record<string, number>;
};

export type BinDocument = {
  workspaceId: string;
  projectId: string;
  /** The layout these coordinates mean something against. Deleted with it. */
  versionId: string;
  pageId: string;
  device: DeviceCategory;
  kind: "click" | "scroll" | "section" | "element";
  /** Grid cell, depth bucket, section id or element id, depending on `kind`. */
  key: string;
  count: number;
  /** Attention time. Only sections accumulate it. */
  ms?: number;
};

export type VitalDocument = {
  workspaceId: string;
  projectId: string;
  day: Date;
  pageId: string;
  device: DeviceCategory;
  metric: WebVital;
  bucket: number;
  count: number;
};

export type SettingsDocument = AnalyticsSettings & { workspaceId: string; projectId: string };

export type SiteViewDocument = {
  workspaceId: string;
  projectId: string;
  /** UTC midnight of the day counted. Also the field the retention index expires on. */
  day: Date;
  path: string;
  views: number;
};

export type TrafficSummary = {
  totalViews: number;
  byDay: Array<{ day: string; views: number }>;
  byPage: Array<{ projectId: string; path: string; views: number }>;
  bySite: Array<{ projectId: string; views: number }>;
};

/** The UTC midnight a moment belongs to. One timezone for everyone, so days never overlap. */
export function utcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/**
 * Requests that are not a person reading a page.
 *
 * Deliberately crude and deliberately biased towards excluding: a customer who sees a number
 * slightly lower than reality is inconvenienced, one whose dashboard counts search-engine crawls as
 * visits is misinformed. An empty agent is excluded too — every browser sends one.
 */
export function isLikelyBot(userAgent: string | undefined): boolean {
  if (userAgent === undefined || userAgent.trim() === "") return true;
  return /bot|crawl|spider|slurp|search|preview|monitor|uptime|pingdom|curl|wget|python-requests|headless|lighthouse|facebookexternalhit|whatsapp|telegram/i.test(
    userAgent,
  );
}

export async function ensureAnalyticsIndexes(db: Db): Promise<void> {
  await db.collection<SiteViewDocument>(ANALYTICS_COLLECTIONS.siteViews).createIndexes([
    // The upsert key. Unique, so two renderer processes counting the same page in the same second
    // increment one row instead of creating two.
    { key: { workspaceId: 1, projectId: 1, path: 1, day: 1 }, name: "counter_unique", unique: true },
    { key: { workspaceId: 1, day: -1 }, name: "workspace_recent" },
    { key: { day: 1 }, name: "retention", expireAfterSeconds: RETENTION_DAYS * 24 * 60 * 60 },
  ]);

  // Every unique index below is also the upsert key for its collection. That is what makes
  // concurrent ingestion safe without a transaction: two renderer processes writing the same
  // counter in the same millisecond contend on the index and one increments what the other created.
  await db.collection<SessionDocument>(ANALYTICS_COLLECTIONS.sessions).createIndexes([
    { key: { workspaceId: 1, projectId: 1, sessionId: 1 }, name: "session_unique", unique: true },
    // The overview query: every session a project started in a window. Its cost is what bounds this
    // design's scale, so it gets the index that makes it a range scan rather than a collection scan.
    { key: { workspaceId: 1, projectId: 1, startedAt: -1 }, name: "project_recent" },
    { key: { startedAt: 1 }, name: "retention", expireAfterSeconds: SESSION_RETENTION_DAYS * 24 * 60 * 60 },
  ]);

  await db.collection<DailyDocument>(ANALYTICS_COLLECTIONS.daily).createIndexes([
    {
      key: { workspaceId: 1, projectId: 1, day: 1, pageId: 1, device: 1, source: 1 },
      name: "counter_unique",
      unique: true,
    },
    { key: { workspaceId: 1, projectId: 1, day: -1 }, name: "project_recent" },
    { key: { day: 1 }, name: "retention", expireAfterSeconds: RETENTION_DAYS * 24 * 60 * 60 },
  ]);

  await db.collection<BinDocument>(ANALYTICS_COLLECTIONS.bins).createIndexes([
    {
      key: { workspaceId: 1, projectId: 1, versionId: 1, pageId: 1, device: 1, kind: 1, key: 1 },
      name: "bin_unique",
      unique: true,
    },
    // No TTL. Bins are deleted with the version they describe, because coordinates against a layout
    // nobody kept cannot be drawn — see `dropVersionData`.
    { key: { workspaceId: 1, projectId: 1, versionId: 1 }, name: "version_scope" },
  ]);

  await db.collection<VitalDocument>(ANALYTICS_COLLECTIONS.vitals).createIndexes([
    {
      key: { workspaceId: 1, projectId: 1, day: 1, pageId: 1, device: 1, metric: 1, bucket: 1 },
      name: "histogram_unique",
      unique: true,
    },
    { key: { workspaceId: 1, projectId: 1, metric: 1, day: -1 }, name: "project_metric_recent" },
    { key: { day: 1 }, name: "retention", expireAfterSeconds: RETENTION_DAYS * 24 * 60 * 60 },
  ]);

  await db
    .collection(ANALYTICS_COLLECTIONS.batches)
    .createIndexes([
      { key: { receivedAt: 1 }, name: "retention", expireAfterSeconds: BATCH_DEDUP_RETENTION_HOURS * 60 * 60 },
    ]);

  await db
    .collection<SettingsDocument>(ANALYTICS_COLLECTIONS.settings)
    .createIndexes([{ key: { workspaceId: 1, projectId: 1 }, name: "project_unique", unique: true }]);
}

export class SiteViewRepository {
  private readonly views: Collection<SiteViewDocument>;

  constructor(db: Db) {
    this.views = db.collection<SiteViewDocument>(ANALYTICS_COLLECTIONS.siteViews);
  }

  /**
   * Counts one view.
   *
   * `path` must come from the published route manifest, never from the request. A request path is
   * attacker-controlled, and counting it directly would let anyone create unbounded rows in a
   * customer's workspace by requesting unique URLs.
   */
  async record(view: { workspaceId: string; projectId: string; path: string; at?: Date }): Promise<void> {
    await this.views.updateOne(
      {
        workspaceId: view.workspaceId,
        projectId: view.projectId,
        path: view.path,
        day: utcDay(view.at ?? new Date()),
      },
      { $inc: { views: 1 } },
      { upsert: true },
    );
  }

  /**
   * Totals for a window, in one round trip.
   *
   * `$facet` rather than four queries: the same matched rows feed every breakdown, so the database
   * scans the range once. Without a project filter this answers for the whole workspace, which is
   * the view the dashboard opens on.
   */
  async summarize(
    context: WorkspaceContext,
    options: { from: Date; to: Date; projectId?: string },
  ): Promise<TrafficSummary> {
    const match = {
      workspaceId: context.workspaceId,
      day: { $gte: utcDay(options.from), $lte: utcDay(options.to) },
      ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
    };

    const [facets] = await this.views
      .aggregate<{
        total: Array<{ views: number }>;
        byDay: Array<{ _id: Date; views: number }>;
        byPage: Array<{ _id: { projectId: string; path: string }; views: number }>;
        bySite: Array<{ _id: string; views: number }>;
      }>([
        { $match: match },
        {
          $facet: {
            total: [{ $group: { _id: null, views: { $sum: "$views" } } }],
            byDay: [{ $group: { _id: "$day", views: { $sum: "$views" } } }, { $sort: { _id: 1 } }],
            byPage: [
              { $group: { _id: { projectId: "$projectId", path: "$path" }, views: { $sum: "$views" } } },
              { $sort: { views: -1 } },
              { $limit: 10 },
            ],
            bySite: [{ $group: { _id: "$projectId", views: { $sum: "$views" } } }, { $sort: { views: -1 } }],
          },
        },
      ])
      .toArray();

    return {
      totalViews: facets?.total[0]?.views ?? 0,
      byDay: (facets?.byDay ?? []).map((row) => ({ day: row._id.toISOString().slice(0, 10), views: row.views })),
      byPage: (facets?.byPage ?? []).map((row) => ({
        projectId: row._id.projectId,
        path: row._id.path,
        views: row.views,
      })),
      bySite: (facets?.bySite ?? []).map((row) => ({ projectId: row._id, views: row.views })),
    };
  }
}

/**
 * Everything the browser tracker produces.
 *
 * Separate from `SiteViewRepository` because the two answer to different rules: server counting is
 * unconditional and stores no identifier, while everything here exists only where a site owner
 * enabled collection and — where required — a visitor agreed to it. Keeping them in one class would
 * make it easy to write a query that silently mixes a consented subset with an unconditional total.
 */
export class AnalyticsRepository {
  private readonly sessions: Collection<SessionDocument>;
  private readonly daily: Collection<DailyDocument>;
  private readonly bins: Collection<BinDocument>;
  private readonly vitals: Collection<VitalDocument>;
  private readonly batches: Collection<{ _id: string; receivedAt: Date }>;
  private readonly settings: Collection<SettingsDocument>;

  constructor(private readonly db: Db) {
    this.sessions = db.collection<SessionDocument>(ANALYTICS_COLLECTIONS.sessions);
    this.daily = db.collection<DailyDocument>(ANALYTICS_COLLECTIONS.daily);
    this.bins = db.collection<BinDocument>(ANALYTICS_COLLECTIONS.bins);
    this.vitals = db.collection<VitalDocument>(ANALYTICS_COLLECTIONS.vitals);
    this.batches = db.collection(ANALYTICS_COLLECTIONS.batches);
    this.settings = db.collection<SettingsDocument>(ANALYTICS_COLLECTIONS.settings);
  }

  /**
   * Claims a batch id, returning false if it was already counted.
   *
   * The first write of every request, before any counter moves. A beacon that is retried — which
   * `sendBeacon` does on its own, and which a flaky connection does for it — carries the id it was
   * assembled with, so the retry is recognised rather than counted again.
   *
   * One insert rather than a per-event uniqueness check: the envelope has no per-event identifier
   * to key on, and adding one would mean an index entry per event instead of per batch.
   */
  async claimBatch(batchId: string, receivedAt: Date): Promise<boolean> {
    try {
      await this.batches.insertOne({ _id: batchId, receivedAt });
      return true;
    } catch (error) {
      if (isDuplicateKey(error)) return false;
      throw error;
    }
  }

  /** Applies one batch's writes. Each collection is one round trip, unordered. */
  async apply(writes: AnalyticsWrites): Promise<void> {
    const work: Array<Promise<unknown>> = [];
    // `ordered: false` because these are independent counters: one failing row must not abandon the
    // rest of a visitor's activity.
    if (writes.sessions.length > 0) work.push(this.sessions.bulkWrite(writes.sessions, { ordered: false }));
    if (writes.daily.length > 0) work.push(this.daily.bulkWrite(writes.daily, { ordered: false }));
    if (writes.bins.length > 0) work.push(this.bins.bulkWrite(writes.bins, { ordered: false }));
    if (writes.vitals.length > 0) work.push(this.vitals.bulkWrite(writes.vitals, { ordered: false }));
    await Promise.all(work);
  }

  async loadSettings(context: WorkspaceContext, projectId: string): Promise<AnalyticsSettings> {
    const document = await this.settings.findOne({ workspaceId: context.workspaceId, projectId });
    // Absent means never configured, which is not the same as configured-and-empty. Reading does not
    // create a row, so a site nobody has visited in settings stays a site with no analytics record.
    if (document === null) return { ...DEFAULT_ANALYTICS_SETTINGS };

    const { _id, workspaceId, projectId: _projectId, ...settings } = document as SettingsDocument & { _id: unknown };
    return settings;
  }

  async saveSettings(
    context: WorkspaceContext,
    projectId: string,
    settings: AnalyticsSettings,
  ): Promise<AnalyticsSettings> {
    await this.settings.updateOne(
      { workspaceId: context.workspaceId, projectId },
      { $set: { ...settings, workspaceId: context.workspaceId, projectId } },
      { upsert: true },
    );
    return settings;
  }

  /**
   * Reads settings for the public renderer, which has no session and therefore no workspace.
   *
   * Scoped by project alone on purpose: the renderer has already resolved the hostname to exactly
   * one project, and that resolution *is* the authorisation. Asking it to also supply a workspace
   * would mean trusting a value it would have had to derive from the same place.
   */
  async loadPublicSettings(projectId: string): Promise<AnalyticsSettings> {
    const document = await this.settings.findOne({ projectId });
    if (document === null) return { ...DEFAULT_ANALYTICS_SETTINGS };

    const { _id, workspaceId, projectId: _projectId, ...settings } = document as SettingsDocument & { _id: unknown };
    return settings;
  }

  /**
   * Removes the spatial data for versions that no longer exist.
   *
   * Called when publishing prunes old versions. A heatmap is coordinates against a layout, so bins
   * whose layout was deleted cannot be drawn over anything — keeping them would mean either
   * rendering them over a layout that did not produce them, which is the failure this design exists
   * to prevent, or storing rows nothing can ever read.
   */
  async dropVersionData(context: WorkspaceContext, projectId: string, versionIds: string[]): Promise<number> {
    if (versionIds.length === 0) return 0;

    const result = await this.bins.deleteMany({
      workspaceId: context.workspaceId,
      projectId,
      versionId: { $in: versionIds },
    });
    return result.deletedCount;
  }

  /**
   * Removes every trace of a project's analytics.
   *
   * Scoped by workspace and project on every collection, so a deletion cannot reach past the
   * project it was asked for. Server-counted views are included: a customer asking to delete their
   * analytics means all of it, not the part that happens to be consent-free.
   */
  async deleteProjectData(context: WorkspaceContext, projectId: string): Promise<Record<string, number>> {
    const scope = { workspaceId: context.workspaceId, projectId };
    const targets: Array<[string, Collection<never>]> = [
      ["sessions", this.sessions as unknown as Collection<never>],
      ["daily", this.daily as unknown as Collection<never>],
      ["bins", this.bins as unknown as Collection<never>],
      ["vitals", this.vitals as unknown as Collection<never>],
      ["siteViews", this.db.collection(ANALYTICS_COLLECTIONS.siteViews) as unknown as Collection<never>],
    ];

    const deleted: Record<string, number> = {};
    for (const [name, collection] of targets) {
      deleted[name] = (await collection.deleteMany(scope as never)).deletedCount;
    }
    return deleted;
  }
}

/** Mongo reports a unique-index collision as code 11000. */
function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === 11000;
}
