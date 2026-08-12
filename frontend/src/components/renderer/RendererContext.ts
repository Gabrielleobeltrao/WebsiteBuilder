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
  /**
   * The stored variants of an asset, so the renderer can offer the browser a real choice.
   * Returning nothing is normal — an external URL has no variants — and yields a plain `src`.
   */
  resolveMediaVariants?: (mediaId: string) => { width: number; height: number }[];
  /** URL of one specific variant width. */
  resolveMediaVariantUrl?: (mediaId: string, width: number) => string | null;
  /**
   * The trail to the page being rendered, outermost first, ending at the page itself.
   *
   * Supplied by whoever knows where this page sits — the renderer has the route manifest, the
   * editor has the document. A breadcrumb block cannot resolve its own trail, and a block that
   * stored one would be a second copy of the site structure that drifts the first time a page moves.
   */
  resolveTrail?: () => ReadonlyArray<{ label: string; href: string | null }>;
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
