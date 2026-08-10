import { z } from "zod";

import { normalizePageSlug } from "./slug";

/**
 * General CMS collections.
 *
 * The blog stays a specialised editorial module rather than being folded in here: it has its own
 * publishing lifecycle, its own dynamic template rules and its own SEO. Forcing posts through a
 * generic collection would make both worse. What they share — stable field ids, draft/published
 * separation, one template per view — is shared deliberately.
 */
export const CMS_FIELD_TYPES = [
  "shortText",
  "longText",
  "richText",
  "number",
  "boolean",
  "date",
  "image",
  "gallery",
  "link",
  "reference",
] as const;
export type CmsFieldType = (typeof CMS_FIELD_TYPES)[number];

export const cmsFieldSchema = z
  .object({
    /** Immutable for the field's whole life. Item values are keyed by this, never by the label. */
    id: z.string().min(1),
    key: z.string().min(1).max(60),
    label: z.string().min(1).max(120),
    type: z.enum(CMS_FIELD_TYPES),
    required: z.boolean(),
    helpText: z.string().max(300).optional(),
    /** Single-reference only in this version; the target must be a collection in the same project. */
    referenceCollectionId: z.string().min(1).optional(),
  })
  .strict()
  .refine((field) => field.type !== "reference" || field.referenceCollectionId !== undefined, {
    message: "a reference field must name the collection it points at",
    path: ["referenceCollectionId"],
  });

export type CmsField = z.infer<typeof cmsFieldSchema>;

export const cmsCollectionInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    slug: z.string().min(1).max(60),
    fields: z.array(cmsFieldSchema).max(50),
  })
  .strict();

export type CmsCollectionInput = z.infer<typeof cmsCollectionInputSchema>;

export const CMS_ITEM_STATUSES = ["draft", "published"] as const;
export type CmsItemStatus = (typeof CMS_ITEM_STATUSES)[number];

export const cmsItemInputSchema = z
  .object({
    slug: z.string().max(120),
    status: z.enum(CMS_ITEM_STATUSES),
    /** Keyed by immutable field id. */
    values: z.record(z.string(), z.unknown()),
    publishedAt: z.string().optional(),
  })
  .strict();

export type CmsItemInput = z.infer<typeof cmsItemInputSchema>;

export function normalizeCollectionSlug(input: string): string {
  return normalizePageSlug(input) || "items";
}

/**
 * Presets that accelerate common business content.
 *
 * They create ordinary editable collections — not hardcoded product types. A preset the user then
 * changes is just a collection, which is the difference between a starting point and a cage.
 */
export const CMS_PRESETS = {
  services: {
    name: "Services",
    slug: "services",
    fields: [
      { id: "title", key: "title", label: "Name", type: "shortText", required: true },
      { id: "summary", key: "summary", label: "Summary", type: "longText", required: false },
      { id: "body", key: "body", label: "Description", type: "richText", required: false },
      { id: "image", key: "image", label: "Image", type: "image", required: false },
    ],
  },
  portfolio: {
    name: "Portfolio",
    slug: "portfolio",
    fields: [
      { id: "title", key: "title", label: "Project", type: "shortText", required: true },
      { id: "client", key: "client", label: "Client", type: "shortText", required: false },
      { id: "gallery", key: "gallery", label: "Images", type: "gallery", required: false },
      { id: "date", key: "date", label: "Delivered", type: "date", required: false },
    ],
  },
  team: {
    name: "Team",
    slug: "team",
    fields: [
      { id: "name", key: "name", label: "Name", type: "shortText", required: true },
      { id: "role", key: "role", label: "Role", type: "shortText", required: false },
      { id: "photo", key: "photo", label: "Photo", type: "image", required: false },
      { id: "bio", key: "bio", label: "Biography", type: "longText", required: false },
    ],
  },
  faq: {
    name: "FAQ",
    slug: "faq",
    fields: [
      { id: "question", key: "question", label: "Question", type: "shortText", required: true },
      { id: "answer", key: "answer", label: "Answer", type: "richText", required: true },
    ],
  },
} as const satisfies Record<string, CmsCollectionInput>;

export type CmsPresetKey = keyof typeof CMS_PRESETS;

export type CmsValidationError = { fieldId: string; code: "required" | "invalid-type" | "reference-outside-project" };

/**
 * Validates item values against the collection's fields.
 *
 * Only declared fields are considered, and a reference is checked against collections in the same
 * project — a reference that could point anywhere would let one site's content resolve into
 * another's.
 */
export function validateCmsItem(
  collection: Pick<CmsCollectionInput, "fields">,
  values: Record<string, unknown>,
  options: { collectionExistsInProject?: (collectionId: string) => boolean } = {},
): { errors: CmsValidationError[]; accepted: Record<string, unknown> } {
  const errors: CmsValidationError[] = [];
  const accepted: Record<string, unknown> = {};

  for (const field of collection.fields) {
    const raw = values[field.id];
    const empty = raw === undefined || raw === null || raw === "" || (Array.isArray(raw) && raw.length === 0);

    if (empty) {
      if (field.required) errors.push({ fieldId: field.id, code: "required" });
      continue;
    }

    if (!matchesType(field.type, raw)) {
      errors.push({ fieldId: field.id, code: "invalid-type" });
      continue;
    }

    if (field.type === "reference" && options.collectionExistsInProject !== undefined) {
      if (!options.collectionExistsInProject(field.referenceCollectionId ?? "")) {
        errors.push({ fieldId: field.id, code: "reference-outside-project" });
        continue;
      }
    }

    accepted[field.id] = raw;
  }

  return { errors, accepted };
}

function matchesType(type: CmsFieldType, value: unknown): boolean {
  switch (type) {
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "gallery":
      return Array.isArray(value) && value.every((entry) => typeof entry === "string");
    case "richText":
      return typeof value === "object" && value !== null;
    default:
      return typeof value === "string";
  }
}

export type SchemaChangeIssue =
  | { code: "required-added"; fieldId: string; itemIds: string[] }
  | { code: "field-removed"; fieldId: string; itemIds: string[] }
  | { code: "type-changed"; fieldId: string; from: CmsFieldType; to: CmsFieldType; itemIds: string[] };

/**
 * Reports what a schema change would do to existing published items.
 *
 * Orphaned values are retained rather than deleted, so a removal is reversible until an explicit
 * cleanup. Only a newly required field with missing values blocks, because that is the one change
 * that makes published content invalid.
 */
export function analyseSchemaChange(input: {
  previous: readonly CmsField[];
  next: readonly CmsField[];
  publishedItems: ReadonlyArray<{ id: string; values: Record<string, unknown> }>;
}): SchemaChangeIssue[] {
  const issues: SchemaChangeIssue[] = [];
  const previousById = new Map(input.previous.map((field) => [field.id, field]));
  const nextIds = new Set(input.next.map((field) => field.id));

  for (const field of input.next) {
    if (field.required && !previousById.get(field.id)?.required) {
      const missing = input.publishedItems.filter((item) => isEmpty(item.values[field.id])).map((item) => item.id);
      if (missing.length > 0) issues.push({ code: "required-added", fieldId: field.id, itemIds: missing });
    }

    const before = previousById.get(field.id);
    if (before !== undefined && before.type !== field.type) {
      issues.push({
        code: "type-changed",
        fieldId: field.id,
        from: before.type,
        to: field.type,
        itemIds: input.publishedItems.filter((item) => !isEmpty(item.values[field.id])).map((item) => item.id),
      });
    }
  }

  for (const field of input.previous) {
    if (nextIds.has(field.id)) continue;
    const affected = input.publishedItems.filter((item) => !isEmpty(item.values[field.id])).map((item) => item.id);
    if (affected.length > 0) issues.push({ code: "field-removed", fieldId: field.id, itemIds: affected });
  }

  return issues;
}

export function blocksSchemaChange(issue: SchemaChangeIssue): boolean {
  return issue.code === "required-added";
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}
