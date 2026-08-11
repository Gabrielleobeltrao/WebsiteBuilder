import { ObjectId, type Db } from "mongodb";

import { COLLECTIONS } from "../../db/indexes";
import { SiteViewRepository, utcDay } from "../analytics/repository";
import { BLOG_COLLECTIONS } from "../blog/repository";
import { FORM_COLLECTIONS } from "../forms/repository";
import type { WorkspaceContext } from "../projects/repository";

/**
 * Workspace dashboard aggregates.
 *
 * Counts are computed in the database rather than by loading documents. A dashboard that fetches
 * every builder document to count pages gets slower with every site a customer adds, which is
 * exactly backwards — and it would move megabytes to produce a single number.
 *
 * Every number here is measured. Where a feature exists but has produced nothing yet, the response
 * says so with `measuredFrom`/`state` rather than a bare zero, because a zero and "nobody is
 * counting" look identical on a card and mean opposite things.
 */
export type WorkspaceDashboard = {
  workspaceId: string;
  clients: { total: number; active: number; needingAttention: number };
  sites: { total: number; withClient: number; direct: number };
  content: { pages: number; publishedPosts: number; draftPosts: number };
  media: { assets: number; storageBytes: number };
  recentSites: Array<{ id: string; name: string; slug: string; updatedAt: string; clientId?: string }>;
  recentClients: Array<{ id: string; name: string; status: string; updatedAt: string }>;
  /**
   * Published-site traffic for the requested window. Site names are joined here so the client
   * renders a dashboard from one response instead of resolving ids against a second call.
   */
  traffic: {
    days: number;
    /** The site the numbers are filtered to, absent when they cover every site. */
    projectId?: string;
    totalViews: number;
    byDay: Array<{ day: string; views: number }>;
    topPages: Array<{ projectId: string; siteName: string; path: string; views: number }>;
    bySite: Array<{ projectId: string; siteName: string; views: number }>;
  };
  forms: {
    definitions: number;
    submissions: number;
    /** Submissions nobody has opened yet — the only number on this card that asks for an action. */
    unread: number;
    /**
     * `no_forms` means the workspace has not built a form, so zero submissions is expected rather
     * than a measurement failure.
     */
    state: "measured" | "no_forms";
  };
};

export type DashboardOptions = {
  /** Window for traffic, in days, ending today. */
  days?: number;
  /** Restricts traffic to one site. Absent means every site in the workspace. */
  projectId?: string;
};

export async function loadWorkspaceDashboard(
  db: Db,
  context: WorkspaceContext,
  options: DashboardOptions = {},
): Promise<WorkspaceDashboard> {
  const workspaceId = context.workspaceId;
  const projects = db.collection(COLLECTIONS.projects);
  const clients = db.collection(COLLECTIONS.clients);
  const media = db.collection(COLLECTIONS.media);
  const posts = db.collection(BLOG_COLLECTIONS.posts);
  const formDefinitions = db.collection(FORM_COLLECTIONS.definitions);
  const formSubmissions = db.collection(FORM_COLLECTIONS.submissions);

  const days = options.days ?? 30;
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

  const [
    clientTotal,
    clientActive,
    clientAttention,
    siteTotal,
    sitesWithClient,
    pageTotal,
    publishedPosts,
    draftPosts,
    mediaTotals,
    recentSites,
    recentClients,
    traffic,
    formTotal,
    submissionTotal,
    submissionUnread,
  ] = await Promise.all([
    clients.countDocuments({ workspaceId }),
    clients.countDocuments({ workspaceId, status: "active" }),
    clients.countDocuments({ workspaceId, status: { $in: ["lead", "paused"] } }),
    projects.countDocuments({ workspaceId }),
    projects.countDocuments({ workspaceId, clientId: { $exists: true, $ne: null } }),
    // $size on the embedded array: the page count without transferring a single page.
    projects
      .aggregate<{ total: number }>([
        { $match: { workspaceId } },
        { $group: { _id: null, total: { $sum: { $size: "$pages" } } } },
        { $project: { _id: 0, total: 1 } },
      ])
      .toArray()
      .then((rows) => rows[0]?.total ?? 0),
    posts.countDocuments({ workspaceId, status: "published" }),
    posts.countDocuments({ workspaceId, status: "draft" }),
    media
      .aggregate<{ assets: number; storageBytes: number }>([
        { $match: { workspaceId } },
        {
          $group: {
            _id: null,
            assets: { $sum: 1 },
            storageBytes: { $sum: { $sum: "$variants.bytes" } },
          },
        },
        { $project: { _id: 0, assets: 1, storageBytes: 1 } },
      ])
      .toArray()
      .then((rows) => rows[0] ?? { assets: 0, storageBytes: 0 }),
    projects
      .find(
        { workspaceId },
        { projection: { name: 1, slug: 1, updatedAt: 1, clientId: 1 }, sort: { updatedAt: -1 }, limit: 5 },
      )
      .toArray(),
    clients
      .find({ workspaceId }, { projection: { name: 1, status: 1, updatedAt: 1 }, sort: { updatedAt: -1 }, limit: 5 })
      .toArray(),
    new SiteViewRepository(db).summarize(context, {
      from,
      to,
      ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
    }),
    formDefinitions.countDocuments({ workspaceId }),
    // Spam is excluded from both: a customer counting rejected junk as interest would act on it.
    formSubmissions.countDocuments({ workspaceId, status: { $ne: "spam" } }),
    formSubmissions.countDocuments({ workspaceId, status: "new" }),
  ]);

  // Names for the ids traffic reported, in one query rather than one per row.
  const siteIds = [...new Set([...traffic.bySite, ...traffic.byPage].map((row) => row.projectId))];
  const namesById = new Map(
    (
      await projects
        .find({ workspaceId, _id: { $in: siteIds.map(toObjectId).filter((id) => id !== null) } }, { projection: { name: 1 } })
        .toArray()
    ).map((site) => [String(site._id), String(site.name)]),
  );
  const siteName = (projectId: string) => namesById.get(projectId) ?? "";

  return {
    workspaceId,
    clients: { total: clientTotal, active: clientActive, needingAttention: clientAttention },
    sites: { total: siteTotal, withClient: sitesWithClient, direct: siteTotal - sitesWithClient },
    content: { pages: pageTotal, publishedPosts, draftPosts },
    media: mediaTotals,
    recentSites: recentSites.map((site) => ({
      id: String(site._id),
      name: String(site.name),
      slug: String(site.slug),
      updatedAt: String(site.updatedAt),
      ...(site.clientId ? { clientId: String(site.clientId) } : {}),
    })),
    recentClients: recentClients.map((client) => ({
      id: String(client._id),
      name: String(client.name),
      status: String(client.status),
      updatedAt: String(client.updatedAt),
    })),
    traffic: {
      days,
      ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
      totalViews: traffic.totalViews,
      // Filled in for the whole window: a day nobody visited is a zero on the chart, not a gap that
      // silently shortens the line.
      byDay: eachDay(from, to).map((day) => ({
        day,
        views: traffic.byDay.find((row) => row.day === day)?.views ?? 0,
      })),
      topPages: traffic.byPage.map((row) => ({ ...row, siteName: siteName(row.projectId) })),
      bySite: traffic.bySite.map((row) => ({ ...row, siteName: siteName(row.projectId) })),
    },
    forms: {
      definitions: formTotal,
      submissions: submissionTotal,
      unread: submissionUnread,
      state: formTotal === 0 ? "no_forms" : "measured",
    },
  };
}

/** Every UTC day in a closed range, as `YYYY-MM-DD`. */
function eachDay(from: Date, to: Date): string[] {
  const days: string[] = [];
  for (let day = utcDay(from); day <= utcDay(to); day = new Date(day.getTime() + 24 * 60 * 60 * 1000)) {
    days.push(day.toISOString().slice(0, 10));
  }
  return days;
}

/** A hex id that is not one returns null rather than throwing, so a stale id cannot fail the page. */
function toObjectId(value: string): ObjectId | null {
  return ObjectId.isValid(value) ? new ObjectId(value) : null;
}
