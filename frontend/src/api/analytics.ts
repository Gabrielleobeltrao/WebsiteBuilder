import type {
  AnalyticsSettings,
  DeviceCategory,
  HeatmapMode,
  WebVital,
  WebVitalRating,
} from "@websitebuilder/shared";

import { apiBase } from "./endpoint";
import { apiRequest } from "./client";

/**
 * The analytics dashboard's view of the API.
 *
 * Response shapes are declared here rather than imported from the backend: the two are separate
 * deployables and the boundary between them is the HTTP contract, not a type import. What is shared
 * is in `@websitebuilder/shared`, and that is the part both sides validate against.
 */

export type AnalyticsOverview = {
  days: number;
  from: string;
  to: string;
  serverViews: number;
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
  comparison: { sessions: number; browserViews: number } | null;
};

export type AnalyticsPages = {
  pages: Array<{ pageId: string; path: string; views: number; clicks: number; scroll: Record<string, number> }>;
};

export type AnalyticsHeatmap = {
  mode: HeatmapMode;
  pageId: string;
  versionId: string;
  device: DeviceCategory;
  samples: number;
  cells: Array<{ key: string; count: number; ms?: number }>;
};

export type AnalyticsVitals = {
  metrics: Array<{
    metric: WebVital;
    device: DeviceCategory;
    samples: number;
    p75: number | null;
    rating: WebVitalRating | null;
  }>;
  minimumSamples: number;
};

export type AnalyticsSnapshot = {
  versionId: string;
  version: number;
  createdAt: string;
  document: unknown;
  pages: Array<{ pageId: string; path: string }>;
};

export type AnalyticsFilters = { days?: number; device?: DeviceCategory; pageIds?: string[] };

function query(filters: AnalyticsFilters): string {
  const params = new URLSearchParams();
  if (filters.days !== undefined) params.set("days", String(filters.days));
  if (filters.device !== undefined) params.set("device", filters.device);
  if (filters.pageIds !== undefined && filters.pageIds.length > 0) params.set("pageIds", filters.pageIds.join(","));
  return params.size === 0 ? "" : `?${params.toString()}`;
}

export const analyticsApi = {
  loadSettings(workspaceId: string, projectId: string, options: { signal?: AbortSignal } = {}) {
    return apiRequest<AnalyticsSettings>(base(workspaceId, projectId, "settings"), {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  },

  saveSettings(workspaceId: string, projectId: string, settings: AnalyticsSettings) {
    return apiRequest<AnalyticsSettings>(base(workspaceId, projectId, "settings"), {
      method: "PUT",
      body: settings,
    });
  },

  overview(workspaceId: string, projectId: string, filters: AnalyticsFilters, options: { signal?: AbortSignal } = {}) {
    return apiRequest<AnalyticsOverview>(base(workspaceId, projectId, `overview${query(filters)}`), {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  },

  pages(workspaceId: string, projectId: string, filters: AnalyticsFilters, options: { signal?: AbortSignal } = {}) {
    return apiRequest<AnalyticsPages>(base(workspaceId, projectId, `pages${query(filters)}`), {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  },

  heatmap(
    workspaceId: string,
    projectId: string,
    filter: { mode: HeatmapMode; pageId: string; versionId: string; device: DeviceCategory },
    options: { signal?: AbortSignal } = {},
  ) {
    const params = new URLSearchParams(filter);
    return apiRequest<AnalyticsHeatmap>(base(workspaceId, projectId, `heatmap?${params.toString()}`), {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  },

  snapshot(workspaceId: string, projectId: string, versionId: string, options: { signal?: AbortSignal } = {}) {
    return apiRequest<AnalyticsSnapshot>(base(workspaceId, projectId, `snapshot/${versionId}`), {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  },

  vitals(workspaceId: string, projectId: string, filters: AnalyticsFilters, options: { signal?: AbortSignal } = {}) {
    return apiRequest<AnalyticsVitals>(base(workspaceId, projectId, `vitals${query(filters)}`), {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  },

  deleteData(workspaceId: string, projectId: string) {
    return apiRequest<{ deleted: Record<string, number> }>(base(workspaceId, projectId, "data"), {
      method: "DELETE",
    });
  },

  /**
   * The CSV download URL.
   *
   * Not fetched through the JSON client, which parses every body as JSON and would throw on a
   * spreadsheet. The browser downloads it directly, carrying the session cookie it already has.
   */
  exportUrl(workspaceId: string, projectId: string, filters: AnalyticsFilters): string {
    return `${apiBase()}${base(workspaceId, projectId, `export.csv${query(filters)}`)}`;
  },
};

const base = (workspaceId: string, projectId: string, suffix: string) =>
  `/workspaces/${workspaceId}/projects/${projectId}/analytics/${suffix}`;
