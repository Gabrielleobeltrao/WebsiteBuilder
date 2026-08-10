import type { Db } from "mongodb";

export const COLLECTIONS = {
  projects: "projects",
  media: "media",
  clients: "clients",
  userPreferences: "userPreferences",
} as const;

/**
 * Every business index starts with `workspaceId`. That is not only for speed: an index that cannot
 * be used without the tenant key makes an accidentally unscoped query obvious in profiling instead
 * of quietly returning another tenant's rows.
 */
export async function ensureIndexes(db: Db): Promise<void> {
  await db.collection(COLLECTIONS.projects).createIndexes([
    { key: { workspaceId: 1, updatedAt: -1 }, name: "workspace_recent" },
    { key: { workspaceId: 1, clientId: 1, updatedAt: -1 }, name: "workspace_client_recent" },
    // Project slugs become public hostnames, so uniqueness is global, not per workspace.
    { key: { slug: 1 }, name: "slug_unique", unique: true },
  ]);

  await db
    .collection(COLLECTIONS.media)
    .createIndexes([{ key: { workspaceId: 1, createdAt: -1 }, name: "workspace_recent" }]);

  await db
    .collection(COLLECTIONS.clients)
    .createIndexes([{ key: { workspaceId: 1, status: 1, updatedAt: -1 }, name: "workspace_status_recent" }]);

  await db
    .collection(COLLECTIONS.userPreferences)
    .createIndexes([{ key: { userId: 1 }, name: "user_unique", unique: true }]);
}
