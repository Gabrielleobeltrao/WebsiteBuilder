import type { Collection, Db } from "mongodb";

import type { WorkspaceContext } from "../projects/repository";

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
export const ANALYTICS_COLLECTIONS = { siteViews: "siteViews" } as const;

/** Just over a year, so a dashboard can always show the same month last year. */
const RETENTION_DAYS = 400;

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
