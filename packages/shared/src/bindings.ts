import type { BlogFieldDefinition, BlogPost, DynamicBinding } from "./blog";

/**
 * Resolves a template's dynamic slots against one post.
 *
 * The template is designed once and rendered with every post's data, so this is the only place that
 * decides what a bound element displays. A binding pointing at a field that no longer exists
 * resolves to a missing value rather than an empty string, because the template preview has to be
 * able to say "this field is gone" instead of silently rendering a blank.
 */

export type ResolvedValue =
  | { state: "value"; kind: "text"; text: string }
  | { state: "value"; kind: "media"; mediaId: string }
  | { state: "value"; kind: "richText"; document: unknown }
  | { state: "value"; kind: "date"; iso: string }
  | { state: "empty" }
  | { state: "missing-field"; fieldId: string };

export type PostSample = Pick<
  BlogPost,
  "title" | "excerpt" | "content" | "coverMediaId" | "authorName" | "publishedAt" | "categoryIds" | "customFieldValues"
>;

export function resolveBinding(
  binding: DynamicBinding,
  post: PostSample,
  fieldDefinitions: readonly BlogFieldDefinition[],
): ResolvedValue {
  if (binding.source === "system") {
    switch (binding.field) {
      case "title":
        return text(post.title);
      case "excerpt":
        return text(post.excerpt);
      case "author":
        return text(post.authorName ?? "");
      case "category":
        return text(post.categoryIds[0] ?? "");
      case "publishedAt":
        return post.publishedAt ? { state: "value", kind: "date", iso: post.publishedAt } : { state: "empty" };
      case "cover":
        return post.coverMediaId
          ? { state: "value", kind: "media", mediaId: post.coverMediaId }
          : { state: "empty" };
      case "content":
        return { state: "value", kind: "richText", document: post.content };
    }
  }

  const definition = fieldDefinitions.find((candidate) => candidate.id === binding.fieldId);
  // A binding whose field was removed is reported, never silently blanked: the designer needs to
  // see which slot lost its source.
  if (definition === undefined) return { state: "missing-field", fieldId: binding.fieldId };

  const raw = post.customFieldValues[definition.id];
  if (raw === undefined || raw === null || raw === "") return { state: "empty" };

  switch (definition.type) {
    case "image":
      return typeof raw === "string" ? { state: "value", kind: "media", mediaId: raw } : { state: "empty" };
    case "richText":
      return { state: "value", kind: "richText", document: raw };
    case "date":
      return typeof raw === "string" ? { state: "value", kind: "date", iso: raw } : { state: "empty" };
    default:
      return text(String(raw));
  }
}

function text(value: string): ResolvedValue {
  return value.trim().length === 0 ? { state: "empty" } : { state: "value", kind: "text", text: value };
}

/**
 * Duplicating a bound element is ambiguous: the designer may want the same value twice, or a
 * second independent field. The caller asks; this produces the binding for whichever they chose.
 */
export function bindingForDuplicate(
  original: DynamicBinding,
  choice: "reuse" | "new-field",
  newFieldId: () => string,
): DynamicBinding {
  if (choice === "reuse" || original.source === "system") return original;
  return { source: "custom", fieldId: newFieldId() };
}

/**
 * Which fields the post form must collect: one control per distinct custom binding used anywhere
 * in the template. Two slots bound to the same field ask once; two distinct fields ask twice.
 */
export function requiredFieldIds(bindings: readonly DynamicBinding[]): string[] {
  return [...new Set(bindings.filter((binding) => binding.source === "custom").map((binding) => binding.fieldId))];
}

/** Bindings whose field no longer exists, so the template editor can flag them for repair. */
export function findOrphanedBindings(
  bindings: readonly DynamicBinding[],
  fieldDefinitions: readonly BlogFieldDefinition[],
): string[] {
  const known = new Set(fieldDefinitions.map((definition) => definition.id));
  return [
    ...new Set(
      bindings
        .filter((binding) => binding.source === "custom" && !known.has(binding.fieldId))
        .map((binding) => (binding.source === "custom" ? binding.fieldId : "")),
    ),
  ];
}
