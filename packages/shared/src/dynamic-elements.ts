import { z } from "zod";

import { dynamicBindingSchema, type DynamicBinding } from "./blog";
import { elementBaseShape } from "./responsive";

/**
 * Elements that exist only inside a template.
 *
 * A dynamic element shows a post's value; an ordinary text or image element beside it is static
 * decoration. The distinction is carried by the element type rather than by a flag, so a renderer
 * can never be uncertain about which one it is holding, and the editor can badge bound elements
 * without inspecting their contents.
 */

/*
 * The same base every other element carries.
 *
 * These declared a parallel one — no payload version, no breakpoint overrides, no appearance — which
 * is part of why they never joined the document union and stayed unbuildable. A block that cannot be
 * migrated, cannot be sized per device and cannot be coloured is not a block anyone can design with.
 */
const templateElementBase = elementBaseShape;

export const dynamicFieldElementSchema = z
  .object({
    ...templateElementBase,
    type: z.literal("dynamicField"),
    binding: dynamicBindingSchema,
    /** How the resolved value is presented. Validated so a template cannot request raw HTML. */
    display: z.enum(["text", "heading", "image", "richText", "date", "link"]),
  })
  .strict();

export type DynamicFieldElement = z.infer<typeof dynamicFieldElementSchema>;

export const POST_COLLECTION_SORTS = ["newest", "oldest", "title"] as const;

export const postCollectionElementSchema = z
  .object({
    ...templateElementBase,
    type: z.literal("postCollection"),
    /** Query is structured data: a template cannot express an arbitrary database query. */
    query: z
      .object({
        categoryId: z.string().min(1).optional(),
        sort: z.enum(POST_COLLECTION_SORTS),
        limit: z.number().int().min(1).max(48),
        paginate: z.boolean(),
      })
      .strict(),
    columns: z.number().int().min(1).max(6),
    gap: z.number().int().min(0).max(80),
    /** Fields shown on each card, in order. */
    cardFields: z.array(dynamicBindingSchema).max(8),
    emptyStateText: z.string().max(300),
  })
  .strict();

export type PostCollectionElement = z.infer<typeof postCollectionElementSchema>;

export const templateElementSchema = z.discriminatedUnion("type", [
  dynamicFieldElementSchema,
  postCollectionElementSchema,
]);

export type TemplateElement = z.infer<typeof templateElementSchema>;

export const DEFAULT_POST_QUERY: PostCollectionElement["query"] = {
  sort: "newest",
  limit: 12,
  paginate: true,
};

/** Every binding a template uses, so the post form knows what to collect. */
export function collectBindings(elements: readonly TemplateElement[]): DynamicBinding[] {
  return elements.flatMap((element) =>
    element.type === "dynamicField" ? [element.binding] : element.cardFields,
  );
}

export type PostQueryResult<T> = { items: T[]; total: number; hasMore: boolean };

/**
 * Applies a collection element's query to a list of published posts.
 *
 * Sorting and limiting happen here rather than in the template, so index and preview produce the
 * same order, and a template can never ask for more than the validated maximum.
 */
export function applyPostQuery<T extends { publishedAt?: string; title: string; categoryIds: string[] }>(
  query: PostCollectionElement["query"],
  posts: readonly T[],
): PostQueryResult<T> {
  const filtered = query.categoryId
    ? posts.filter((post) => post.categoryIds.includes(query.categoryId as string))
    : [...posts];

  const sorted = filtered.sort((a, b) => {
    if (query.sort === "title") return a.title.localeCompare(b.title);
    const left = a.publishedAt ?? "";
    const right = b.publishedAt ?? "";
    return query.sort === "oldest" ? left.localeCompare(right) : right.localeCompare(left);
  });

  return {
    items: sorted.slice(0, query.limit),
    total: sorted.length,
    hasMore: sorted.length > query.limit,
  };
}

/** The members, exported so the document union can spread them in. */
export const DYNAMIC_ELEMENT_SCHEMAS = [dynamicFieldElementSchema, postCollectionElementSchema] as const;

export const dynamicElementSchema = z.discriminatedUnion("type", [...DYNAMIC_ELEMENT_SCHEMAS]);

export type DynamicElement = z.infer<typeof dynamicElementSchema>;
