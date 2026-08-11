import type { CmsCollectionInput, CmsField, CmsItemInput, CmsItemStatus, SchemaChangeIssue } from "@websitebuilder/shared";

import { apiRequest } from "./client";

export type CmsCollection = CmsCollectionInput & {
  id: string;
  workspaceId: string;
  projectId: string;
  hasDetailRoute: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CmsItem = CmsItemInput & {
  id: string;
  collectionId: string;
  createdAt: string;
  updatedAt: string;
};

export type CmsItemPage = { items: CmsItem[]; total: number; page: number; perPage: number };

export type CollectionBody = CmsCollectionInput & { hasDetailRoute?: boolean };

const base = (workspaceId: string, projectId: string) =>
  `/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/cms`;

export const cmsApi = {
  collections(workspaceId: string, projectId: string, options: { signal?: AbortSignal } = {}) {
    return apiRequest<CmsCollection[]>(`${base(workspaceId, projectId)}/collections`, {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  },

  createCollection(workspaceId: string, projectId: string, body: CollectionBody) {
    return apiRequest<CmsCollection>(`${base(workspaceId, projectId)}/collections`, { method: "POST", body });
  },

  updateCollection(workspaceId: string, projectId: string, collectionId: string, body: CollectionBody) {
    return apiRequest<CmsCollection>(
      `${base(workspaceId, projectId)}/collections/${encodeURIComponent(collectionId)}`,
      { method: "PUT", body },
    );
  },

  deleteCollection(workspaceId: string, projectId: string, collectionId: string) {
    return apiRequest<null>(`${base(workspaceId, projectId)}/collections/${encodeURIComponent(collectionId)}`, {
      method: "DELETE",
    });
  },

  items(
    workspaceId: string,
    projectId: string,
    collectionId: string,
    query: { status?: CmsItemStatus; search?: string; page?: number } = {},
    options: { signal?: AbortSignal } = {},
  ) {
    const params = new URLSearchParams();
    if (query.status !== undefined) params.set("status", query.status);
    if (query.search !== undefined && query.search !== "") params.set("search", query.search);
    if (query.page !== undefined) params.set("page", String(query.page));

    const suffix = params.toString() === "" ? "" : `?${params.toString()}`;
    return apiRequest<CmsItemPage>(
      `${base(workspaceId, projectId)}/collections/${encodeURIComponent(collectionId)}/items${suffix}`,
      { ...(options.signal ? { signal: options.signal } : {}) },
    );
  },

  createItem(workspaceId: string, projectId: string, collectionId: string, body: CmsItemInput) {
    return apiRequest<CmsItem>(
      `${base(workspaceId, projectId)}/collections/${encodeURIComponent(collectionId)}/items`,
      { method: "POST", body },
    );
  },

  updateItem(workspaceId: string, projectId: string, itemId: string, body: CmsItemInput) {
    return apiRequest<CmsItem>(`${base(workspaceId, projectId)}/items/${encodeURIComponent(itemId)}`, {
      method: "PUT",
      body,
    });
  },

  duplicateItem(workspaceId: string, projectId: string, itemId: string) {
    return apiRequest<CmsItem>(`${base(workspaceId, projectId)}/items/${encodeURIComponent(itemId)}/duplicate`, {
      method: "POST",
    });
  },

  deleteItem(workspaceId: string, projectId: string, itemId: string) {
    return apiRequest<null>(`${base(workspaceId, projectId)}/items/${encodeURIComponent(itemId)}`, {
      method: "DELETE",
    });
  },
};

export type { CmsField, SchemaChangeIssue };
