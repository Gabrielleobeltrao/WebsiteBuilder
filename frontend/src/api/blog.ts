import type { BlogFormat, BlogPost, BlogPostInput, BlogSettings } from "@websitebuilder/shared";

import { apiRequest } from "./client";

export type PostPage = { items: BlogPost[]; total: number; page: number; perPage: number };

const scope = (workspaceId: string, projectId: string) =>
  `/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/blog`;

export const blogApi = {
  loadSettings(workspaceId: string, projectId: string, options: { signal?: AbortSignal } = {}) {
    return apiRequest<BlogSettings>(`${scope(workspaceId, projectId)}/settings`, {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  },

  /**
   * Turns the blog on with a format, in one request.
   *
   * Not `saveSettings({ enabled: true })`: that set a flag and left the blog unable to serve either
   * of the routes it publishes, which blocked publication of the whole site with no way out through
   * the interface. The server creates the templates and points the settings at them.
   */
  activate(workspaceId: string, projectId: string, format: BlogFormat) {
    return apiRequest<BlogSettings>(`${scope(workspaceId, projectId)}/activate`, {
      method: "POST",
      body: { format },
    });
  },

  saveSettings(workspaceId: string, projectId: string, settings: BlogSettings) {
    return apiRequest<BlogSettings>(`${scope(workspaceId, projectId)}/settings`, {
      method: "PUT",
      body: settings,
    });
  },

  listPosts(
    workspaceId: string,
    projectId: string,
    filter: { status?: string; search?: string; page?: number; signal?: AbortSignal } = {},
  ) {
    const query = new URLSearchParams();
    if (filter.status) query.set("status", filter.status);
    if (filter.search) query.set("search", filter.search);
    if (filter.page) query.set("page", String(filter.page));

    const suffix = query.toString() === "" ? "" : `?${query.toString()}`;
    return apiRequest<PostPage>(`${scope(workspaceId, projectId)}/posts${suffix}`, {
      ...(filter.signal ? { signal: filter.signal } : {}),
    });
  },

  loadPost(workspaceId: string, projectId: string, postId: string, options: { signal?: AbortSignal } = {}) {
    return apiRequest<BlogPost>(`${scope(workspaceId, projectId)}/posts/${postId}`, {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  },

  createPost(workspaceId: string, projectId: string, input: BlogPostInput) {
    return apiRequest<BlogPost>(`${scope(workspaceId, projectId)}/posts`, { method: "POST", body: input });
  },

  updatePost(workspaceId: string, projectId: string, postId: string, input: BlogPostInput) {
    return apiRequest<BlogPost>(`${scope(workspaceId, projectId)}/posts/${postId}`, { method: "PUT", body: input });
  },

  setPostStatus(workspaceId: string, projectId: string, postId: string, status: "published" | "draft") {
    const action = status === "published" ? "publish" : "unpublish";
    return apiRequest<BlogPost>(`${scope(workspaceId, projectId)}/posts/${postId}/${action}`, { method: "POST" });
  },

  deletePost(workspaceId: string, projectId: string, postId: string) {
    return apiRequest<void>(`${scope(workspaceId, projectId)}/posts/${postId}`, { method: "DELETE" });
  },
};
