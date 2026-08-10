import type { Db } from "mongodb";

import { COLLECTIONS } from "../../db/indexes";
import { BLOG_COLLECTIONS } from "../blog/repository";
import type { WorkspaceContext } from "../projects/repository";

/**
 * Workspace dashboard aggregates.
 *
 * Counts are computed in the database rather than by loading documents. A dashboard that fetches
 * every builder document to count pages gets slower with every site a customer adds, which is
 * exactly backwards — and it would move megabytes to produce a single number.
 *
 * Analytics stay explicitly absent. Rendering a zero where no measurement exists would be a
 * fabricated number presented as data.
 */
export type WorkspaceDashboard = {
  workspaceId: string;
  clients: { total: number; active: number; needingAttention: number };
  sites: { total: number; withClient: number; direct: number };
  content: { pages: number; publishedPosts: number; draftPosts: number };
  media: { assets: number; storageBytes: number };
  recentSites: Array<{ id: string; name: string; slug: string; updatedAt: string; clientId?: string }>;
  recentClients: Array<{ id: string; name: string; status: string; updatedAt: string }>;
  /** Deliberately not a number. No provider is connected, so there is nothing to report. */
  analytics: { state: "not_connected" };
};

export async function loadWorkspaceDashboard(db: Db, context: WorkspaceContext): Promise<WorkspaceDashboard> {
  const workspaceId = context.workspaceId;
  const projects = db.collection(COLLECTIONS.projects);
  const clients = db.collection(COLLECTIONS.clients);
  const media = db.collection(COLLECTIONS.media);
  const posts = db.collection(BLOG_COLLECTIONS.posts);

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
  ]);

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
    analytics: { state: "not_connected" },
  };
}
