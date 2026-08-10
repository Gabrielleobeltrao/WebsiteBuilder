import { API_BASE_PATH } from "@websitebuilder/shared";

import { ApiError, apiRequest } from "./client";

export type MediaVariant = { width: number; height: number; bytes: number; mimeType: "image/webp"; storageKey: string };

export type MediaAsset = {
  id: string;
  workspaceId: string;
  originalFilename: string;
  width: number;
  height: number;
  defaultAlt?: string;
  variants: MediaVariant[];
  createdAt: string;
};

const scope = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/media`;

/** URL for one asset, optionally asking for the smallest variant covering a width. */
export function mediaUrl(workspaceId: string, mediaId: string, width?: number): string {
  const query = width === undefined ? "" : `?w=${Math.round(width)}`;
  return `${API_BASE_PATH}${scope(workspaceId)}/${encodeURIComponent(mediaId)}/content${query}`;
}

/**
 * Builds the `srcset`/`sizes` pair from the stored variants.
 *
 * The browser picks the variant, which is the whole point of generating them: the renderer states
 * what exists and how much space it takes, and the device decides what to download.
 */
export function mediaSrcSet(workspaceId: string, asset: Pick<MediaAsset, "id" | "variants">): string {
  return asset.variants
    .slice()
    .sort((a, b) => a.width - b.width)
    .map((variant) => `${mediaUrl(workspaceId, asset.id, variant.width)} ${variant.width}w`)
    .join(", ");
}

export const mediaApi = {
  list(workspaceId: string, options: { signal?: AbortSignal } = {}) {
    return apiRequest<MediaAsset[]>(scope(workspaceId), {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  },

  /**
   * Uploads raw bytes. `fetch` is used directly rather than the JSON helper because the body is
   * binary and the filename travels in a header.
   */
  async upload(workspaceId: string, file: File, defaultAlt?: string): Promise<MediaAsset> {
    let response: Response;
    try {
      response = await fetch(`${API_BASE_PATH}${scope(workspaceId)}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/octet-stream",
          // Header values must be ISO-8859-1; encoding keeps accented filenames from throwing.
          "x-filename": encodeURIComponent(file.name),
          ...(defaultAlt ? { "x-default-alt": encodeURIComponent(defaultAlt) } : {}),
        },
        body: file,
      });
    } catch {
      throw new ApiError("NETWORK_ERROR", 0);
    }

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code =
        typeof payload === "object" && payload !== null && "error" in payload
          ? ((payload as { error: { code: string } }).error.code as "INTERNAL_ERROR")
          : "INTERNAL_ERROR";
      throw new ApiError(code, response.status);
    }
    return (payload as { data: MediaAsset }).data;
  },

  remove(workspaceId: string, mediaId: string) {
    return apiRequest<void>(`${scope(workspaceId)}/${mediaId}`, { method: "DELETE" });
  },
};
