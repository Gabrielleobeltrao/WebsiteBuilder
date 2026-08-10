/**
 * The public roadmap is product communication, not a copy of the execution plan. Items carry a
 * stable ID, a status and an optional period — never internal architecture, and never a date the
 * product team has not committed to. Titles and descriptions live in the locale catalogues.
 */

export const ROADMAP_STATUSES = ["released", "in_progress", "planned", "under_consideration"] as const;
export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];

export const ROADMAP_CATEGORIES = ["editor", "content", "publishing", "collaboration", "platform"] as const;
export type RoadmapCategory = (typeof ROADMAP_CATEGORIES)[number];

/**
 * Item IDs are a literal union, not `string`, so `t("roadmap.items.<id>.title")` only compiles for
 * an item that actually exists in both locale catalogues. Adding an item without translating it
 * becomes a type error instead of a missing string on the page.
 */
export const ROADMAP_ITEM_IDS = [
  "visual-editor",
  "responsive-system",
  "media-library",
  "blog",
  "cms-collections",
  "forms",
  "site-audit",
  "publishing",
  "custom-domains",
  "static-export",
  "collaboration",
  "ai-assist",
  "analytics",
  "multilingual-sites",
] as const;
export type RoadmapItemId = (typeof ROADMAP_ITEM_IDS)[number];

export type RoadmapItem = {
  id: RoadmapItemId;
  status: RoadmapStatus;
  category: RoadmapCategory;
  /** Only set when a period has actually been committed. Absent means "no committed date". */
  targetPeriod?: string;
  order: number;
};

export const ROADMAP_ITEMS: readonly RoadmapItem[] = [
  { id: "visual-editor", status: "released", category: "editor", order: 1 },
  { id: "responsive-system", status: "released", category: "editor", order: 2 },
  { id: "media-library", status: "released", category: "content", order: 3 },
  { id: "blog", status: "in_progress", category: "content", order: 4 },
  { id: "cms-collections", status: "in_progress", category: "content", order: 5 },
  { id: "forms", status: "in_progress", category: "content", order: 6 },
  { id: "site-audit", status: "in_progress", category: "publishing", order: 7 },
  { id: "publishing", status: "planned", category: "publishing", order: 8 },
  { id: "custom-domains", status: "planned", category: "publishing", order: 9 },
  { id: "static-export", status: "under_consideration", category: "publishing", order: 10 },
  { id: "collaboration", status: "under_consideration", category: "collaboration", order: 11 },
  { id: "ai-assist", status: "under_consideration", category: "editor", order: 12 },
  { id: "analytics", status: "under_consideration", category: "platform", order: 13 },
  { id: "multilingual-sites", status: "under_consideration", category: "platform", order: 14 },
];

export function roadmapItemsByStatus(status: RoadmapStatus | "all"): RoadmapItem[] {
  const items = status === "all" ? [...ROADMAP_ITEMS] : ROADMAP_ITEMS.filter((item) => item.status === status);
  return items.sort((a, b) => a.order - b.order);
}

/** Items shown in the landing page preview: what already works, then what is being built. */
export function roadmapPreviewItems(limit = 4): RoadmapItem[] {
  const weight: Record<RoadmapStatus, number> = {
    released: 0,
    in_progress: 1,
    planned: 2,
    under_consideration: 3,
  };
  return [...ROADMAP_ITEMS]
    .sort((a, b) => weight[a.status] - weight[b.status] || a.order - b.order)
    .slice(0, limit);
}
