import type { SiteFeatureState } from "@websitebuilder/shared";

import { apiRequest } from "./client";

export type SiteStatus = {
  projectId: string;
  revision: number;
  features: SiteFeatureState[];
  blocked: boolean;
  blockingIssueCount: number;
  warningCount: number;
};

export const siteStatusApi = {
  load(workspaceId: string, projectId: string, options: { signal?: AbortSignal } = {}) {
    return apiRequest<SiteStatus>(
      `/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/status`,
      { ...(options.signal ? { signal: options.signal } : {}) },
    );
  },
};
