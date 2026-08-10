import { describe, expect, it } from "vitest";

import {
  applyPostQuery,
  collectBindings,
  DEFAULT_POST_QUERY,
  dynamicFieldElementSchema,
  postCollectionElementSchema,
  type TemplateElement,
} from "./dynamic-elements";

const base = {
  id: "e1",
  name: "Slot",
  geometry: { x: 0, y: 0, width: 320, height: 64, rotation: 0 },
  responsiveLayout: {
    width: { value: 320, unit: "px" as const },
    height: { value: 64, unit: "px" as const },
    horizontalConstraint: "left" as const,
    verticalConstraint: "top" as const,
    visible: true,
  },
  zIndex: 1,
  locked: false,
  hidden: false,
};

const dynamicField = (overrides: Record<string, unknown> = {}) => ({
  ...base,
  type: "dynamicField",
  binding: { source: "system", field: "title" },
  display: "heading",
  ...overrides,
});

const collection = (overrides: Record<string, unknown> = {}) => ({
  ...base,
  type: "postCollection",
  query: DEFAULT_POST_QUERY,
  columns: 3,
  gap: 24,
  cardFields: [{ source: "system", field: "title" }],
  emptyStateText: "No posts yet",
  ...overrides,
});

describe("dynamicField schema", () => {
  it("accepts a system and a custom binding", () => {
    expect(dynamicFieldElementSchema.safeParse(dynamicField()).success).toBe(true);
    expect(
      dynamicFieldElementSchema.safeParse(dynamicField({ binding: { source: "custom", fieldId: "f1" } })).success,
    ).toBe(true);
  });

  it("rejects a display mode outside the allowlist, so a template cannot request raw HTML", () => {
    expect(dynamicFieldElementSchema.safeParse(dynamicField({ display: "html" })).success).toBe(false);
    expect(dynamicFieldElementSchema.safeParse(dynamicField({ display: "innerHTML" })).success).toBe(false);
  });

  it("rejects an unknown binding source", () => {
    expect(
      dynamicFieldElementSchema.safeParse(dynamicField({ binding: { source: "sql", query: "SELECT 1" } })).success,
    ).toBe(false);
  });

  it("rejects unknown properties", () => {
    expect(dynamicFieldElementSchema.safeParse(dynamicField({ onClick: "steal()" })).success).toBe(false);
  });
});

describe("postCollection schema", () => {
  it("accepts a structured query", () => {
    expect(postCollectionElementSchema.safeParse(collection()).success).toBe(true);
  });

  it("caps the limit so a template cannot request an unbounded page", () => {
    expect(postCollectionElementSchema.safeParse(collection({ query: { ...DEFAULT_POST_QUERY, limit: 500 } })).success).toBe(
      false,
    );
    expect(postCollectionElementSchema.safeParse(collection({ query: { ...DEFAULT_POST_QUERY, limit: 0 } })).success).toBe(
      false,
    );
  });

  it("rejects an arbitrary sort expression", () => {
    expect(
      postCollectionElementSchema.safeParse(collection({ query: { ...DEFAULT_POST_QUERY, sort: "RANDOM()" } })).success,
    ).toBe(false);
  });

  it("bounds the column count and card field list", () => {
    expect(postCollectionElementSchema.safeParse(collection({ columns: 12 })).success).toBe(false);
    expect(
      postCollectionElementSchema.safeParse(
        collection({ cardFields: Array.from({ length: 9 }, () => ({ source: "system", field: "title" })) }),
      ).success,
    ).toBe(false);
  });
});

describe("collectBindings", () => {
  it("gathers bindings from dynamic fields and collection cards alike", () => {
    const elements = [
      dynamicField({ binding: { source: "custom", fieldId: "f1" } }),
      collection({ cardFields: [{ source: "custom", fieldId: "f2" }, { source: "system", field: "title" }] }),
    ] as unknown as TemplateElement[];

    expect(collectBindings(elements)).toEqual([
      { source: "custom", fieldId: "f1" },
      { source: "custom", fieldId: "f2" },
      { source: "system", field: "title" },
    ]);
  });
});

describe("applyPostQuery", () => {
  const posts = [
    { title: "Beta", publishedAt: "2026-08-02T00:00:00.000Z", categoryIds: ["news"] },
    { title: "Alpha", publishedAt: "2026-08-05T00:00:00.000Z", categoryIds: [] },
    { title: "Gamma", publishedAt: "2026-08-01T00:00:00.000Z", categoryIds: ["news"] },
  ];

  it("sorts newest first by default", () => {
    const result = applyPostQuery(DEFAULT_POST_QUERY, posts);
    expect(result.items.map((post) => post.title)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("sorts oldest first and by title on request", () => {
    expect(
      applyPostQuery({ ...DEFAULT_POST_QUERY, sort: "oldest" }, posts).items.map((post) => post.title),
    ).toEqual(["Gamma", "Beta", "Alpha"]);
    expect(
      applyPostQuery({ ...DEFAULT_POST_QUERY, sort: "title" }, posts).items.map((post) => post.title),
    ).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("filters by category", () => {
    const result = applyPostQuery({ ...DEFAULT_POST_QUERY, categoryId: "news" }, posts);
    expect(result.items.map((post) => post.title)).toEqual(["Beta", "Gamma"]);
    expect(result.total).toBe(2);
  });

  it("limits and reports that more exist", () => {
    const result = applyPostQuery({ ...DEFAULT_POST_QUERY, limit: 2 }, posts);
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(3);
    expect(result.hasMore).toBe(true);
  });

  it("does not mutate the list it was given", () => {
    const original = [...posts];
    applyPostQuery({ ...DEFAULT_POST_QUERY, sort: "title" }, posts);
    expect(posts).toEqual(original);
  });

  it("adding a matching post makes it appear without editing the layout", () => {
    const before = applyPostQuery(DEFAULT_POST_QUERY, posts);
    const after = applyPostQuery(DEFAULT_POST_QUERY, [
      ...posts,
      { title: "Newest", publishedAt: "2026-08-09T00:00:00.000Z", categoryIds: [] },
    ]);

    expect(before.items[0]?.title).toBe("Alpha");
    expect(after.items[0]?.title).toBe("Newest");
  });
});
