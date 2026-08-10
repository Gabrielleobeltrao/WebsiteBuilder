import { z } from "zod";

import { safeLinkSchema, type SafeLink } from "./links";

/**
 * Navigation menu contract.
 *
 * Destinations are typed links, resolved by the same safe-link utility as every other link in the
 * product. Internal entries reference a page **id**, so renaming a page or changing its slug keeps
 * the menu pointing at the same page instead of quietly 404-ing across the whole site.
 */

export type NavigationItem = {
  id: string;
  label: string;
  link: SafeLink;
  /** One level of submenu is supported; deeper nesting is not navigable on touch. */
  children?: NavigationItem[];
};

export const navigationItemSchema: z.ZodType<NavigationItem> = z.lazy(() =>
  z
    .object({
      id: z.string().min(1),
      label: z.string().min(1).max(80),
      link: safeLinkSchema,
      children: z.array(navigationChildSchema).max(20).optional(),
    })
    .strict(),
) as z.ZodType<NavigationItem>;

const navigationChildSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1).max(80),
    link: safeLinkSchema,
  })
  .strict();

export const NAVIGATION_LAYOUTS = ["horizontal", "vertical"] as const;

export const navigationConfigSchema = z
  .object({
    items: z.array(navigationItemSchema).max(30),
    layout: z.enum(NAVIGATION_LAYOUTS),
    /** Below this width the menu collapses into a drawer. */
    collapseBelow: z.number().int().min(320).max(1920),
    showBlogLink: z.boolean(),
    gap: z.number().int().min(0).max(80),
  })
  .strict();

export type NavigationConfig = z.infer<typeof navigationConfigSchema>;

export const DEFAULT_NAVIGATION: NavigationConfig = {
  items: [],
  layout: "horizontal",
  collapseBelow: 768,
  showBlogLink: false,
  gap: 24,
};

/** Whether the menu should render as a drawer at a given width. */
export function shouldCollapse(config: Pick<NavigationConfig, "collapseBelow">, width: number): boolean {
  return width < config.collapseBelow;
}

export type ResolvedNavigationItem = {
  id: string;
  label: string;
  href: string | null;
  target?: "_blank";
  rel?: "noopener noreferrer";
  /** True when the item points at the page currently being viewed. */
  current: boolean;
  children: ResolvedNavigationItem[];
};

/**
 * Resolves every destination once, so the renderer never decides what a link means.
 *
 * An item whose target no longer exists keeps its label and resolves to no href. It renders as
 * plain text rather than disappearing: a menu that silently loses entries is far harder to notice
 * and repair than one showing an item that visibly does not navigate.
 */
export function resolveNavigation(
  config: NavigationConfig,
  options: {
    resolvePagePath: (pageId: string) => string | null;
    resolveLink: (link: SafeLink) => { href: string; target?: "_blank"; rel?: "noopener noreferrer" } | null;
    currentPath?: string;
  },
): ResolvedNavigationItem[] {
  const resolveOne = (item: NavigationItem): ResolvedNavigationItem => {
    const resolved = options.resolveLink(item.link);
    return {
      id: item.id,
      label: item.label,
      href: resolved?.href ?? null,
      ...(resolved?.target ? { target: resolved.target } : {}),
      ...(resolved?.rel ? { rel: resolved.rel } : {}),
      current: resolved?.href !== undefined && resolved.href === options.currentPath,
      children: (item.children ?? []).map(resolveOne),
    };
  };

  return config.items.map(resolveOne);
}

/** Menu entries whose destination no longer resolves, so the editor can flag them for repair. */
export function findBrokenNavigationItems(items: readonly ResolvedNavigationItem[]): ResolvedNavigationItem[] {
  return items.flatMap((item) => [
    ...(item.href === null ? [item] : []),
    ...findBrokenNavigationItems(item.children),
  ]);
}
