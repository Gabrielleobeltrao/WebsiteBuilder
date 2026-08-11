import { z } from "zod";

import { normalizePageSlug } from "./slug";
import { geometrySchema, responsiveElementLayoutSchema } from "./responsive";

/**
 * The CMS collection element and the query behind it.
 *
 * A list is bound to a collection by id and its card shows fields by their immutable field ids, so
 * publishing a matching item adds it to every configured listing without anyone editing those
 * pages. That is the whole promise of a dynamic list, and it only holds because nothing here refers
 * to a field by its label.
 *
 * The query is structured data with validated bounds. A page can express "newest twelve, filtered
 * by this field" and nothing else — there is no shape in which a template becomes an arbitrary
 * database query.
 */
export const CMS_SORT_DIRECTIONS = ["newest", "oldest", "field-asc", "field-desc"] as const;
export type CmsSortDirection = (typeof CMS_SORT_DIRECTIONS)[number];

export const cmsFilterSchema = z
  .object({
    fieldId: z.string().min(1),
    operator: z.enum(["equals", "not-equals", "contains", "is-true", "is-false"]),
    /** Absent for the boolean operators, which carry their value in the operator itself. */
    value: z.union([z.string().max(200), z.number(), z.boolean()]).optional(),
  })
  .strict();

export type CmsFilter = z.infer<typeof cmsFilterSchema>;

export const cmsQuerySchema = z
  .object({
    collectionId: z.string().min(1),
    filters: z.array(cmsFilterSchema).max(5),
    sort: z.enum(CMS_SORT_DIRECTIONS),
    /** Required by the field sorts; ignored by the date sorts. */
    sortFieldId: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(48),
    paginate: z.boolean(),
  })
  .strict();

export type CmsQuery = z.infer<typeof cmsQuerySchema>;

export const cmsCardFieldSchema = z
  .object({
    fieldId: z.string().min(1),
    display: z.enum(["text", "heading", "image", "richText", "date", "link"]),
  })
  .strict();

export type CmsCardField = z.infer<typeof cmsCardFieldSchema>;

export const cmsCollectionElementSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().max(120),
    geometry: geometrySchema,
    responsiveLayout: responsiveElementLayoutSchema,
    zIndex: z.number().int(),
    locked: z.boolean(),
    hidden: z.boolean(),
    type: z.literal("cmsCollection"),
    query: cmsQuerySchema,
    layout: z.enum(["grid", "list"]),
    columns: z.number().int().min(1).max(6),
    gap: z.number().int().min(0).max(80),
    /** One card sub-layout, reused for every item. */
    cardFields: z.array(cmsCardFieldSchema).max(8),
    /** Shown when the query matches nothing. Editable, because "no results" is a design decision. */
    emptyStateText: z.string().max(300),
    /** Site content, not interface copy: it is written in the language of the published site. */
    loadMoreText: z.string().max(60),
    /** Whether a card links to the item's own page. Only meaningful for collections that have one. */
    linkToDetail: z.boolean(),
  })
  .strict();

export type CmsCollectionElement = z.infer<typeof cmsCollectionElementSchema>;

export const DEFAULT_CMS_QUERY: CmsQuery = {
  collectionId: "",
  filters: [],
  sort: "newest",
  limit: 12,
  paginate: true,
};

export type QueryableItem = {
  id: string;
  collectionId: string;
  slug: string;
  status: "draft" | "published";
  values: Record<string, unknown>;
  publishedAt?: string;
  updatedAt: string;
};

export type CmsQueryResult<T> = { items: T[]; total: number; hasMore: boolean; page: number };

/**
 * Runs a list element's query.
 *
 * Drafts are excluded here rather than at the caller, because every caller — index, preview and
 * published output — must agree, and one that forgets would publish unfinished content.
 */
export function applyCmsQuery<T extends QueryableItem>(
  query: CmsQuery,
  items: readonly T[],
  options: { page?: number; includeDrafts?: boolean } = {},
): CmsQueryResult<T> {
  const page = Math.max(1, options.page ?? 1);

  const matching = items.filter(
    (item) =>
      item.collectionId === query.collectionId &&
      (options.includeDrafts === true || item.status === "published") &&
      query.filters.every((filter) => matchesFilter(filter, item.values[filter.fieldId])),
  );

  const sorted = [...matching].sort((a, b) => compare(query, a, b));

  const start = query.paginate ? (page - 1) * query.limit : 0;
  const window = sorted.slice(start, start + query.limit);

  return {
    items: window,
    total: sorted.length,
    hasMore: start + query.limit < sorted.length,
    page,
  };
}

function matchesFilter(filter: CmsFilter, value: unknown): boolean {
  switch (filter.operator) {
    case "is-true":
      return value === true;
    case "is-false":
      // Absent counts as false: an item that never set the field is not "true".
      return value === false || value === undefined || value === null;
    case "equals":
      return value === filter.value;
    case "not-equals":
      return value !== filter.value;
    case "contains":
      return typeof value === "string" && typeof filter.value === "string"
        ? value.toLowerCase().includes(filter.value.toLowerCase())
        : false;
  }
}

function compare<T extends QueryableItem>(query: CmsQuery, a: T, b: T): number {
  if (query.sort === "field-asc" || query.sort === "field-desc") {
    const fieldId = query.sortFieldId;
    // A field sort with no field named falls back to newest rather than to an arbitrary order:
    // an unstable list is worse than one sorted differently than intended.
    if (fieldId === undefined) return byDate(a, b, "newest");

    const left = String(a.values[fieldId] ?? "");
    const right = String(b.values[fieldId] ?? "");
    const result = left.localeCompare(right, undefined, { numeric: true });
    return query.sort === "field-asc" ? result : -result;
  }

  return byDate(a, b, query.sort);
}

function byDate(a: QueryableItem, b: QueryableItem, direction: "newest" | "oldest"): number {
  const left = a.publishedAt ?? a.updatedAt;
  const right = b.publishedAt ?? b.updatedAt;
  return direction === "oldest" ? left.localeCompare(right) : right.localeCompare(left);
}

/** The public path of one item. Built in one place so lists, detail routes and the sitemap agree. */
export function cmsItemPath(collectionSlug: string, itemSlug: string): string {
  return `/${normalizePageSlug(collectionSlug)}/${normalizePageSlug(itemSlug)}`;
}

/**
 * Which field ids a list element needs.
 *
 * Used to report a card that still points at a field the schema no longer has — the binding is not
 * silently dropped, because a card rendering blank is a bug someone has to find by looking.
 */
export function orphanedCardFields(
  element: Pick<CmsCollectionElement, "cardFields" | "query">,
  fieldIds: ReadonlySet<string>,
): string[] {
  return element.cardFields.map((card) => card.fieldId).filter((fieldId) => !fieldIds.has(fieldId));
}

/**
 * The detail template for one collection.
 *
 * Exactly one template per collection renders every item, existing and future. It carries its own
 * draft and published copies: editing the draft must not change what visitors already see, because
 * a template edit applies to every item at once and there is no way to preview that safely if it is
 * live while being written.
 */
export const cmsDetailTemplateSchema = z
  .object({
    collectionId: z.string().min(1),
    /** Sections are ordinary builder sections; the dynamic parts are card fields bound by id. */
    draftSections: z.array(z.unknown()),
    publishedSections: z.array(z.unknown()).optional(),
    /** Falls back to the item's own values, then to the site defaults. */
    seo: z
      .object({
        titleFieldId: z.string().min(1).optional(),
        descriptionFieldId: z.string().min(1).optional(),
        imageFieldId: z.string().min(1).optional(),
      })
      .strict(),
    publishedAt: z.string().optional(),
    updatedAt: z.string(),
  })
  .strict();

export type CmsDetailTemplate = z.infer<typeof cmsDetailTemplateSchema>;

/** A collection resolves item routes only once its template has been published at least once. */
export function hasPublishedTemplate(template: CmsDetailTemplate | undefined): boolean {
  return template?.publishedSections !== undefined && template.publishedAt !== undefined;
}

/** True when the draft has moved on from what is live, so the editor can say so plainly. */
export function templateHasUnpublishedChanges(template: CmsDetailTemplate | undefined): boolean {
  if (template === undefined) return false;
  if (template.publishedSections === undefined) return template.draftSections.length > 0;
  return JSON.stringify(template.draftSections) !== JSON.stringify(template.publishedSections);
}

export type TemplateImpact = {
  /** Items that will be re-rendered by publishing this template. */
  affectedItemCount: number;
  /** Card fields pointing at fields the schema no longer declares. */
  orphanedFieldIds: string[];
};

/**
 * What publishing a template would do.
 *
 * One template renders every item, so the count is the honest scale of the change: a designer
 * editing "the page" is editing hundreds of pages at once.
 */
export function templateImpact(input: {
  publishedItemCount: number;
  cardFieldIds: readonly string[];
  schemaFieldIds: ReadonlySet<string>;
}): TemplateImpact {
  return {
    affectedItemCount: input.publishedItemCount,
    orphanedFieldIds: input.cardFieldIds.filter((fieldId) => !input.schemaFieldIds.has(fieldId)),
  };
}

/**
 * Resolves the metadata for one item's page.
 *
 * Each part falls back independently: a template that names a title field but no description field
 * still inherits the site description rather than rendering an empty one.
 */
export function resolveItemSeo(input: {
  template: Pick<CmsDetailTemplate, "seo">;
  values: Record<string, unknown>;
  itemSlug: string;
  siteDefaults: { title: string; description: string };
}): { title: string; description: string } {
  const read = (fieldId: string | undefined): string => {
    if (fieldId === undefined) return "";
    const value = input.values[fieldId];
    return typeof value === "string" ? value.trim() : "";
  };

  return {
    title: read(input.template.seo.titleFieldId) || input.itemSlug || input.siteDefaults.title,
    description: read(input.template.seo.descriptionFieldId) || input.siteDefaults.description,
  };
}
