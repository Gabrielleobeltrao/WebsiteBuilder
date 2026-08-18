import type { DynamicBinding, PublishablePost, PublishedForm } from "@websitebuilder/shared";
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
  /**
   * Where "home" is, for the one block that links there without naming a page.
   *
   * A site logo links to the front of the site, not to a page the author picked — so it has no page
   * id to resolve. It used to ask `resolvePagePath("")`, which is not a page id and therefore always
   * returned null: every linked logo on every published site rendered unlinked. Absent here means
   * the host has no navigation of its own, which is the correct answer inside the builder canvas.
   */
  homePath?: string | null;
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

  /**
   * The form a block references, as the surface being rendered should show it.
   *
   * The builder and the draft preview resolve the draft definition; a published page resolves the
   * revision frozen into its own snapshot. Returning null is a real answer — the block says which
   * of "not chosen", "gone" and "archived" it is in, rather than rendering nothing.
   */
  resolveForm?: (formId: string) => PublishedForm | null;
  /** Whether the fields are operable, and whether submitting reaches a server. */
  formMode?: "inert" | "preview" | "live";
  /** Where a live form posts. One function so the endpoint is named in exactly one place. */
  formAction?: (formId: string) => string;
  /** What a visitor without JavaScript was sent back with after posting. */
  formResult?: { formId: string; state: "ok" | "error" } | null;
  /**
   * The record a template is being rendered for, if any.
   *
   * A template is a page whose blocks show somebody else's values, so the values have to arrive from
   * outside: the article route supplies the post, the index route supplies none. Absent means this
   * is not a template rendering — which is the honest state inside the builder, where a bound block
   * shows the name of the field it is bound to rather than a value it does not have.
   */
  post?: PublishablePost;
  /**
   * What a binding resolves to right now.
   *
   * A function rather than a bag of values, because a custom field is looked up by id and the set of
   * them belongs to the site, not to this interface.
   */
  resolveBinding?: (binding: DynamicBinding) => string | undefined;
  /** The posts a list block shows. Supplied by whoever ran the query; the block never runs one. */
  posts?: readonly PublishablePost[];

  /** Copy for the states a form has that its own definition does not describe. */
  formStrings?: {
    unbound: string;
    missing: string;
    archived: string;
    error: string;
    required: string;
  };
};

const fallback: RendererContextValue = {
  resolvePagePath: () => null,
  resolveMediaUrl: () => null,
};

export const RendererContext = createContext<RendererContextValue>(fallback);

export function useRendererContext(): RendererContextValue {
  return useContext(RendererContext);
}
