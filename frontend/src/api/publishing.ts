import type { PreflightReport, PublishedSiteVersion, SiteDomain } from "@websitebuilder/shared";

import { apiRequest } from "./client";

/**
 * Publishing and domain endpoints.
 *
 * `document` is deliberately absent from the version type used here: history and the publish screen
 * only ever need the summary, and shipping a full site snapshot to the browser to render a list
 * would be a large download for no benefit.
 */
export type VersionSummary = Omit<PublishedSiteVersion, "document">;

export type PreflightResponse = { report: PreflightReport; contentHash: string | null };

export type PublishResponse = { version: VersionSummary; unchanged: boolean };

export type ConnectDomainResponse = { domain: SiteDomain; providerReachable: boolean };

const base = (workspaceId: string, projectId: string) =>
  `/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/publishing`;

export const publishingApi = {
  preflight(workspaceId: string, projectId: string, options: { signal?: AbortSignal } = {}) {
    return apiRequest<PreflightResponse>(`${base(workspaceId, projectId)}/preflight`, {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  },

  publish(workspaceId: string, projectId: string) {
    return apiRequest<PublishResponse>(base(workspaceId, projectId), { method: "POST" });
  },

  history(workspaceId: string, projectId: string, options: { signal?: AbortSignal } = {}) {
    return apiRequest<VersionSummary[]>(`${base(workspaceId, projectId)}/versions`, {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  },

  rollback(workspaceId: string, projectId: string, versionId: string) {
    return apiRequest<VersionSummary>(
      `${base(workspaceId, projectId)}/versions/${encodeURIComponent(versionId)}/rollback`,
      { method: "POST" },
    );
  },

  domains(workspaceId: string, projectId: string, options: { signal?: AbortSignal } = {}) {
    return apiRequest<SiteDomain[]>(`${base(workspaceId, projectId)}/domains`, {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  },

  connectDomain(workspaceId: string, projectId: string, hostname: string) {
    return apiRequest<ConnectDomainResponse>(`${base(workspaceId, projectId)}/domains/custom`, {
      method: "POST",
      body: { hostname },
    });
  },

  refreshDomain(workspaceId: string, projectId: string, domainId: string) {
    return apiRequest<SiteDomain>(
      `${base(workspaceId, projectId)}/domains/${encodeURIComponent(domainId)}/refresh`,
      { method: "POST" },
    );
  },

  makePrimary(workspaceId: string, projectId: string, domainId: string) {
    return apiRequest<SiteDomain>(
      `${base(workspaceId, projectId)}/domains/${encodeURIComponent(domainId)}/primary`,
      { method: "POST" },
    );
  },

  disconnectDomain(workspaceId: string, projectId: string, domainId: string) {
    return apiRequest<null>(`${base(workspaceId, projectId)}/domains/${encodeURIComponent(domainId)}`, {
      method: "DELETE",
    });
  },
};
