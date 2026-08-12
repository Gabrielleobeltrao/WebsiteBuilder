import type {
  FormDefinitionInput,
  FormDetail,
  FormRecord,
  FormSummary,
  SubmissionPage,
  SubmissionStatus,
} from "@websitebuilder/shared";

import { API_BASE_PATH } from "@websitebuilder/shared";

import { apiRequest } from "./client";

/**
 * The Forms Center's half of the contract.
 *
 * Every response shape comes from the shared package rather than being restated here: a second copy
 * of one shape is how a field ends up meaning different things on the two sides of a request.
 */
export type SubmissionQuery = {
  formId?: string;
  status?: SubmissionStatus;
  from?: string;
  to?: string;
  pageId?: string;
  page?: number;
  perPage?: number;
};

const scope = (workspaceId: string, projectId: string) =>
  `/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/forms`;

function queryString(query: SubmissionQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized === "" ? "" : `?${serialized}`;
}

export const formsApi = {
  list(workspaceId: string, projectId: string, options: { signal?: AbortSignal } = {}) {
    return apiRequest<FormSummary[]>(scope(workspaceId, projectId), {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  },

  load(workspaceId: string, projectId: string, formId: string, options: { signal?: AbortSignal } = {}) {
    return apiRequest<FormDetail>(`${scope(workspaceId, projectId)}/${formId}`, {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  },

  create(workspaceId: string, projectId: string, input: FormDefinitionInput) {
    return apiRequest<FormRecord>(scope(workspaceId, projectId), { method: "POST", body: input });
  },

  update(workspaceId: string, projectId: string, formId: string, input: FormDefinitionInput, expectedRevision: number) {
    return apiRequest<FormRecord>(`${scope(workspaceId, projectId)}/${formId}`, {
      method: "PUT",
      body: { ...input, expectedRevision },
    });
  },

  duplicate(workspaceId: string, projectId: string, formId: string, name: string) {
    return apiRequest<FormRecord>(`${scope(workspaceId, projectId)}/${formId}/duplicate`, {
      method: "POST",
      body: { name },
    });
  },

  restore(workspaceId: string, projectId: string, formId: string) {
    return apiRequest<FormRecord>(`${scope(workspaceId, projectId)}/${formId}/restore`, { method: "POST" });
  },

  remove(workspaceId: string, projectId: string, formId: string) {
    return apiRequest<{ outcome: "deleted" | "archived" }>(`${scope(workspaceId, projectId)}/${formId}`, {
      method: "DELETE",
    });
  },

  listSubmissions(workspaceId: string, projectId: string, query: SubmissionQuery & { signal?: AbortSignal } = {}) {
    const { signal, ...filter } = query;
    return apiRequest<SubmissionPage>(`${scope(workspaceId, projectId)}/-/submissions${queryString(filter)}`, {
      ...(signal ? { signal } : {}),
    });
  },

  bulk(
    workspaceId: string,
    projectId: string,
    ids: readonly string[],
    action: SubmissionStatus | "delete",
  ) {
    return apiRequest<{ changed: number }>(`${scope(workspaceId, projectId)}/-/submissions`, {
      method: "PATCH",
      body: { ids, action },
    });
  },

  /**
   * Where the browser should send someone to download an export.
   *
   * A URL rather than a fetch: the response is a file, and letting the browser navigate to it gets
   * the download, the filename and the progress indicator for free — all of which a blob assembled
   * in memory would have to reimplement, badly, while holding the whole export in the tab.
   */
  exportUrl(workspaceId: string, projectId: string, formId: string, query: SubmissionQuery = {}) {
    return `${API_BASE_PATH}${scope(workspaceId, projectId)}/${formId}/submissions.csv${queryString(query)}`;
  },
};
