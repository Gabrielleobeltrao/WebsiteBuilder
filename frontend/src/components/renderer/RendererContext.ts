import { createContext, useContext } from "react";

/**
 * Everything the renderer needs from its host, and nothing more.
 *
 * The renderer is shared by the editor, the preview route and the published site. Keeping its
 * dependencies to this small resolver interface is what stops editor concerns from leaking into
 * public output: there is no store to reach for and no selection state to read.
 */
export type RendererContextValue = {
  /** Path for an internal page link, or null when the target no longer exists. */
  resolvePagePath: (pageId: string) => string | null;
  /** URL for an uploaded media asset, or null when it is unavailable. */
  resolveMediaUrl: (mediaId: string) => string | null;
  /** Allows http links in local development only. */
  allowHttp?: boolean;
};

const fallback: RendererContextValue = {
  resolvePagePath: () => null,
  resolveMediaUrl: () => null,
};

export const RendererContext = createContext<RendererContextValue>(fallback);

export function useRendererContext(): RendererContextValue {
  return useContext(RendererContext);
}
