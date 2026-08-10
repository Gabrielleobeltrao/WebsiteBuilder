import { describe, expect, it } from "vitest";

import {
  analyseSchemaChange,
  blocksSchemaChange,
  cmsCollectionInputSchema,
  cmsFieldSchema,
  CMS_PRESETS,
  normalizeCollectionSlug,
  validateCmsItem,
  type CmsField,
} from "./cms";

const field = (overrides: Partial<CmsField> = {}): CmsField => ({
  id: "title",
  key: "title",
  label: "Title",
  type: "shortText",
  required: false,
  ...overrides,
});

describe("field schema", () => {
  it("requires a reference field to name its target collection", () => {
    expect(cmsFieldSchema.safeParse(field({ type: "reference" })).success).toBe(false);
    expect(
      cmsFieldSchema.safeParse(field({ type: "reference", referenceCollectionId: "c1" })).success,
    ).toBe(true);
  });

  it("rejects an unknown field type and unknown properties", () => {
    expect(cmsFieldSchema.safeParse(field({ type: "file" as never })).success).toBe(false);
    expect(cmsFieldSchema.safeParse({ ...field(), sql: "SELECT 1" }).success).toBe(false);
  });
});

describe("presets", () => {
  it("produce ordinary editable collections, not hardcoded product types", () => {
    for (const preset of Object.values(CMS_PRESETS)) {
      expect(cmsCollectionInputSchema.safeParse(preset).success).toBe(true);
    }
  });

  it("give every preset field a stable id", () => {
    for (const preset of Object.values(CMS_PRESETS)) {
      const ids = preset.fields.map((f) => f.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("normalises a collection slug and never yields an empty one", () => {
    expect(normalizeCollectionSlug("Nossos Serviços")).toBe("nossos-servicos");
    expect(normalizeCollectionSlug("!!")).toBe("items");
  });
});

describe("validateCmsItem", () => {
  const collection = {
    fields: [
      field({ id: "title", required: true }),
      field({ id: "count", type: "number" }),
      field({ id: "active", type: "boolean" }),
      field({ id: "images", type: "gallery" }),
      field({ id: "related", type: "reference", referenceCollectionId: "c2" }),
    ],
  };

  it("accepts a valid item keyed by field id", () => {
    const result = validateCmsItem(collection, {
      title: "A service",
      count: 3,
      active: true,
      images: ["m1", "m2"],
    });

    expect(result.errors).toEqual([]);
    expect(result.accepted).toEqual({ title: "A service", count: 3, active: true, images: ["m1", "m2"] });
  });

  it("reports a missing required field", () => {
    expect(validateCmsItem(collection, {}).errors).toContainEqual({ fieldId: "title", code: "required" });
  });

  it("rejects a value of the wrong type instead of coercing it", () => {
    const result = validateCmsItem(collection, { title: "A", count: "three", active: "yes" });
    expect(result.errors).toContainEqual({ fieldId: "count", code: "invalid-type" });
    expect(result.errors).toContainEqual({ fieldId: "active", code: "invalid-type" });
  });

  it("ignores values for fields the collection does not declare", () => {
    const result = validateCmsItem(collection, { title: "A", injected: "x", projectId: "other" });
    expect(result.accepted).not.toHaveProperty("injected");
    expect(result.accepted).not.toHaveProperty("projectId");
  });

  it("refuses a reference to a collection outside this project", () => {
    const result = validateCmsItem(
      collection,
      { title: "A", related: "item-1" },
      { collectionExistsInProject: () => false },
    );
    expect(result.errors).toContainEqual({ fieldId: "related", code: "reference-outside-project" });
  });

  it("accepts a reference within the project", () => {
    const result = validateCmsItem(
      collection,
      { title: "A", related: "item-1" },
      { collectionExistsInProject: (id) => id === "c2" },
    );
    expect(result.errors).toEqual([]);
    expect(result.accepted.related).toBe("item-1");
  });
});

describe("analyseSchemaChange", () => {
  const items = [
    { id: "i1", values: { title: "Set" } },
    { id: "i2", values: {} },
  ];

  it("blocks a newly required field and names the items missing it", () => {
    const issues = analyseSchemaChange({
      previous: [field()],
      next: [field({ required: true })],
      publishedItems: items,
    });

    expect(issues).toEqual([{ code: "required-added", fieldId: "title", itemIds: ["i2"] }]);
    expect(issues.every(blocksSchemaChange)).toBe(true);
  });

  it("reports a removed field without blocking, because values are retained", () => {
    const issues = analyseSchemaChange({ previous: [field()], next: [], publishedItems: items });

    expect(issues).toEqual([{ code: "field-removed", fieldId: "title", itemIds: ["i1"] }]);
    expect(issues.some(blocksSchemaChange)).toBe(false);
  });

  it("reports a type change with the items holding a value in the old type", () => {
    const issues = analyseSchemaChange({
      previous: [field({ type: "shortText" })],
      next: [field({ type: "number" })],
      publishedItems: items,
    });
    expect(issues[0]).toMatchObject({ code: "type-changed", from: "shortText", to: "number", itemIds: ["i1"] });
  });

  it("does not report a field that was already required", () => {
    const issues = analyseSchemaChange({
      previous: [field({ required: true })],
      next: [field({ required: true })],
      publishedItems: items,
    });
    expect(issues).toEqual([]);
  });

  it("reports nothing when a label is renamed, because ids are what matter", () => {
    const issues = analyseSchemaChange({
      previous: [field({ label: "Title" })],
      next: [field({ label: "Heading" })],
      publishedItems: items,
    });
    expect(issues).toEqual([]);
  });

  it("never blocks on an optional new field", () => {
    const issues = analyseSchemaChange({
      previous: [],
      next: [field({ id: "new", required: false })],
      publishedItems: items,
    });
    expect(issues).toEqual([]);
  });
});
