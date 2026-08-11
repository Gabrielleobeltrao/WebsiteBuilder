import { apiRequest } from "./client";

/**
 * The workspace overview. One request answers the whole page: the server joins site names onto the
 * traffic rows, so the client never resolves ids against a second call and the page cannot render
 * half-populated.
 */
export type WorkspaceDashboard = {
  workspaceId: string;
  clients: { total: number; active: number; needingAttention: number };
  sites: { total: number; withClient: number; direct: number };
  content: { pages: number; publishedPosts: number; draftPosts: number };
  media: { assets: number; storageBytes: number };
  recentSites: Array<{ id: string; name: string; slug: string; updatedAt: string; clientId?: string }>;
  recentClients: Array<{ id: string; name: string; status: string; updatedAt: string }>;
  traffic: {
    days: number;
    projectId?: string;
    totalViews: number;
    byDay: Array<{ day: string; views: number }>;
    topPages: Array<{ projectId: string; siteName: string; path: string; views: number }>;
    bySite: Array<{ projectId: string; siteName: string; views: number }>;
  };
  forms: { definitions: number; submissions: number; unread: number; state: "measured" | "no_forms" };
};

/** The windows the server accepts. Sending anything else is a validation error, not a wider range. */
export const DASHBOARD_WINDOWS = [7, 30, 90] as const;
export type DashboardWindow = (typeof DASHBOARD_WINDOWS)[number];

export const dashboardApi = {
  load(
    workspaceId: string,
    options: { days?: DashboardWindow; projectId?: string; signal?: AbortSignal } = {},
  ) {
    const query = new URLSearchParams();
    if (options.days !== undefined) query.set("days", String(options.days));
    if (options.projectId !== undefined && options.projectId !== "") query.set("projectId", options.projectId);
    const suffix = query.size === 0 ? "" : `?${query.toString()}`;

    return apiRequest<WorkspaceDashboard>(`/workspaces/${workspaceId}/dashboard${suffix}`, {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  },
};
