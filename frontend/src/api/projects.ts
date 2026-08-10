import type { BuilderDocumentInput, BuilderProject, ProjectSummary } from "@websitebuilder/shared";

import { apiRequest } from "./client";

/**
 * Every path starts with the workspace, so a caller cannot accidentally request a project without
 * naming the tenant it believes it is acting for. The server verifies membership regardless.
 */
const scope = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/projects`;

export const projectsApi = {
  list(workspaceId: string, options: { clientId?: string; signal?: AbortSignal } = {}) {
    const query = options.clientId ? `?clientId=${encodeURIComponent(options.clientId)}` : "";
    return apiRequest<ProjectSummary[]>(`${scope(workspaceId)}${query}`, {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  },

  create(workspaceId: string, input: { name: string; clientId?: string }) {
    return apiRequest<BuilderProject>(scope(workspaceId), { method: "POST", body: input });
  },

  load(workspaceId: string, projectId: string, options: { signal?: AbortSignal } = {}) {
    return apiRequest<BuilderProject>(`${scope(workspaceId)}/${projectId}`, {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  },

  rename(workspaceId: string, projectId: string, name: string) {
    return apiRequest<BuilderProject>(`${scope(workspaceId)}/${projectId}`, { method: "PATCH", body: { name } });
  },

  saveDocument(workspaceId: string, projectId: string, revision: number, document: BuilderDocumentInput) {
    return apiRequest<BuilderProject>(`${scope(workspaceId)}/${projectId}/document`, {
      method: "PUT",
      body: { revision, document },
    });
  },

  remove(workspaceId: string, projectId: string) {
    return apiRequest<void>(`${scope(workspaceId)}/${projectId}`, { method: "DELETE" });
  },
};
