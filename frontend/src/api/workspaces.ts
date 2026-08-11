import { apiRequest } from "./client";

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  kind: "personal" | "agency";
  role: string;
};

export const workspacesApi = {
  list(options: { signal?: AbortSignal } = {}) {
    return apiRequest<WorkspaceSummary[]>("/workspaces", {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  },
};
