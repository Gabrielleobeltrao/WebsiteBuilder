import { describe, expect, it } from "vitest";

import {
  bindingForDuplicate,
  findOrphanedBindings,
  requiredFieldIds,
  resolveBinding,
  type PostSample,
} from "./bindings";
import { EMPTY_RICH_TEXT, type BlogFieldDefinition, type DynamicBinding } from "./blog";

const field = (overrides: Partial<BlogFieldDefinition> = {}): BlogFieldDefinition => ({
  id: "f1",
  key: "subtitle",
  label: "Subtitle",
  type: "shortText",
  required: false,
  ...overrides,
});

const post = (overrides: Partial<PostSample> = {}): PostSample => ({
  title: "Release notes",
  excerpt: "What changed",
  content: EMPTY_RICH_TEXT,
  categoryIds: ["cat-1"],
  customFieldValues: { f1: "A subtitle" },
  ...overrides,
});

describe("system bindings", () => {
  it("resolves each system field from the post", () => {
    const sample = post({ authorName: "Ana", coverMediaId: "m1", publishedAt: "2026-08-02T00:00:00.000Z" });

    expect(resolveBinding({ source: "system", field: "title" }, sample, [])).toEqual({
      state: "value",
      kind: "text",
      text: "Release notes",
    });
    expect(resolveBinding({ source: "system", field: "author" }, sample, [])).toMatchObject({ text: "Ana" });
    expect(resolveBinding({ source: "system", field: "cover" }, sample, [])).toEqual({
      state: "value",
      kind: "media",
      mediaId: "m1",
    });
    expect(resolveBinding({ source: "system", field: "publishedAt" }, sample, [])).toMatchObject({ kind: "date" });
    expect(resolveBinding({ source: "system", field: "content" }, sample, [])).toMatchObject({ kind: "richText" });
  });

  it("reports empty rather than a blank string when a system field has no value", () => {
    const sample = post({ excerpt: "   ", authorName: undefined, coverMediaId: undefined });

    expect(resolveBinding({ source: "system", field: "excerpt" }, sample, [])).toEqual({ state: "empty" });
    expect(resolveBinding({ source: "system", field: "author" }, sample, [])).toEqual({ state: "empty" });
    expect(resolveBinding({ source: "system", field: "cover" }, sample, [])).toEqual({ state: "empty" });
    expect(resolveBinding({ source: "system", field: "publishedAt" }, sample, [])).toEqual({ state: "empty" });
  });
});

describe("custom bindings", () => {
  it("resolves a custom field by stable id", () => {
    expect(resolveBinding({ source: "custom", fieldId: "f1" }, post(), [field()])).toEqual({
      state: "value",
      kind: "text",
      text: "A subtitle",
    });
  });

  it("keeps resolving through a label rename, because the id did not change", () => {
    expect(resolveBinding({ source: "custom", fieldId: "f1" }, post(), [field({ label: "Kicker" })])).toMatchObject({
      text: "A subtitle",
    });
  });

  it("reports a removed field rather than silently rendering a blank", () => {
    expect(resolveBinding({ source: "custom", fieldId: "f1" }, post(), [])).toEqual({
      state: "missing-field",
      fieldId: "f1",
    });
  });

  it("resolves each custom field type into the shape the renderer needs", () => {
    const sample = post({
      customFieldValues: { img: "m2", body: { type: "doc" }, when: "2026-08-02", note: 7 },
    });
    const definitions = [
      field({ id: "img", type: "image" }),
      field({ id: "body", type: "richText" }),
      field({ id: "when", type: "date" }),
      field({ id: "note", type: "shortText" }),
    ];

    expect(resolveBinding({ source: "custom", fieldId: "img" }, sample, definitions)).toMatchObject({ kind: "media" });
    expect(resolveBinding({ source: "custom", fieldId: "body" }, sample, definitions)).toMatchObject({
      kind: "richText",
    });
    expect(resolveBinding({ source: "custom", fieldId: "when" }, sample, definitions)).toMatchObject({ kind: "date" });
    expect(resolveBinding({ source: "custom", fieldId: "note" }, sample, definitions)).toMatchObject({ text: "7" });
  });

  it("reports empty for a field the author left blank", () => {
    const sample = post({ customFieldValues: { f1: "" } });
    expect(resolveBinding({ source: "custom", fieldId: "f1" }, sample, [field()])).toEqual({ state: "empty" });
  });
});

describe("requiredFieldIds", () => {
  it("asks once for two slots bound to the same field", () => {
    const bindings: DynamicBinding[] = [
      { source: "custom", fieldId: "f1" },
      { source: "custom", fieldId: "f1" },
      { source: "system", field: "title" },
    ];
    expect(requiredFieldIds(bindings)).toEqual(["f1"]);
  });

  it("asks twice for two distinct fields", () => {
    const bindings: DynamicBinding[] = [
      { source: "custom", fieldId: "image-a" },
      { source: "custom", fieldId: "image-b" },
    ];
    expect(requiredFieldIds(bindings)).toEqual(["image-a", "image-b"]);
  });
});

describe("bindingForDuplicate", () => {
  it("reuses the binding when the designer wants the same value twice", () => {
    const original: DynamicBinding = { source: "custom", fieldId: "f1" };
    expect(bindingForDuplicate(original, "reuse", () => "f2")).toEqual(original);
  });

  it("creates a new field when the designer wants another value", () => {
    const original: DynamicBinding = { source: "custom", fieldId: "f1" };
    expect(bindingForDuplicate(original, "new-field", () => "f2")).toEqual({ source: "custom", fieldId: "f2" });
  });

  it("never forks a system binding, because there is only one title", () => {
    const original: DynamicBinding = { source: "system", field: "title" };
    expect(bindingForDuplicate(original, "new-field", () => "f2")).toEqual(original);
  });
});

describe("findOrphanedBindings", () => {
  it("lists bindings whose field is gone, once each", () => {
    const bindings: DynamicBinding[] = [
      { source: "custom", fieldId: "f1" },
      { source: "custom", fieldId: "gone" },
      { source: "custom", fieldId: "gone" },
      { source: "system", field: "title" },
    ];
    expect(findOrphanedBindings(bindings, [field()])).toEqual(["gone"]);
  });

  it("reports nothing when every binding resolves", () => {
    expect(findOrphanedBindings([{ source: "custom", fieldId: "f1" }], [field()])).toEqual([]);
  });
});
