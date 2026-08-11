import { describe, expect, it } from "vitest";

import {
  applyCmsQuery,
  cmsItemPath,
  DEFAULT_CMS_QUERY,
  orphanedCardFields,
  type CmsQuery,
  type QueryableItem,
} from "./cms-elements";

const item = (overrides: Partial<QueryableItem> = {}): QueryableItem => ({
  id: "i1",
  collectionId: "c1",
  slug: "one",
  status: "published",
  values: {},
  publishedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const query = (overrides: Partial<CmsQuery> = {}): CmsQuery => ({
  ...DEFAULT_CMS_QUERY,
  collectionId: "c1",
  ...overrides,
});

describe("scope", () => {
  it("returns only items of the bound collection", () => {
    const result = applyCmsQuery(query(), [item(), item({ id: "i2", collectionId: "c2" })]);
    expect(result.items.map((entry) => entry.id)).toEqual(["i1"]);
  });

  it("excludes drafts, so an unfinished item cannot reach a published list", () => {
    const result = applyCmsQuery(query(), [item(), item({ id: "i2", status: "draft" })]);
    expect(result.items.map((entry) => entry.id)).toEqual(["i1"]);
  });

  it("includes drafts only when the editor asks for samples", () => {
    const result = applyCmsQuery(query(), [item({ id: "i2", status: "draft" })], { includeDrafts: true });
    expect(result.items).toHaveLength(1);
  });

  it("adds a newly published item to a list without touching the list", () => {
    // This is the whole promise of a dynamic list: the page is not edited, the query simply matches.
    const before = applyCmsQuery(query(), [item()]);
    const after = applyCmsQuery(query(), [item(), item({ id: "i2", slug: "two" })]);

    expect(before.total).toBe(1);
    expect(after.total).toBe(2);
  });
});

describe("filters", () => {
  const featured = (value: unknown) => item({ id: String(value), values: { "f-featured": value } });

  it("treats a missing value as false rather than as unknown", () => {
    const result = applyCmsQuery(
      query({ filters: [{ fieldId: "f-featured", operator: "is-false" }] }),
      [featured(false), featured(true), item({ id: "absent" })],
    );

    expect(result.items.map((entry) => entry.id).sort()).toEqual(["absent", "false"]);
  });

  it("matches text case-insensitively for contains", () => {
    const result = applyCmsQuery(
      query({ filters: [{ fieldId: "f-title", operator: "contains", value: "acme" }] }),
      [item({ id: "a", values: { "f-title": "ACME Studio" } }), item({ id: "b", values: { "f-title": "Other" } })],
    );

    expect(result.items.map((entry) => entry.id)).toEqual(["a"]);
  });

  it("applies every filter, not just the first", () => {
    const result = applyCmsQuery(
      query({
        filters: [
          { fieldId: "f-featured", operator: "is-true" },
          { fieldId: "f-title", operator: "equals", value: "Keep" },
        ],
      }),
      [
        item({ id: "a", values: { "f-featured": true, "f-title": "Keep" } }),
        item({ id: "b", values: { "f-featured": true, "f-title": "Drop" } }),
      ],
    );

    expect(result.items.map((entry) => entry.id)).toEqual(["a"]);
  });
});

describe("sorting", () => {
  const dated = (id: string, publishedAt: string) => item({ id, publishedAt });

  it("orders by publication date in both directions", () => {
    const items = [dated("old", "2026-01-01T00:00:00.000Z"), dated("new", "2026-06-01T00:00:00.000Z")];

    expect(applyCmsQuery(query({ sort: "newest" }), items).items.map((entry) => entry.id)).toEqual(["new", "old"]);
    expect(applyCmsQuery(query({ sort: "oldest" }), items).items.map((entry) => entry.id)).toEqual(["old", "new"]);
  });

  it("sorts by a field, numerically where the values are numeric", () => {
    const items = [
      item({ id: "b", values: { "f-order": "10" } }),
      item({ id: "a", values: { "f-order": "2" } }),
    ];

    const result = applyCmsQuery(query({ sort: "field-asc", sortFieldId: "f-order" }), items);
    // "10" must not sort before "2".
    expect(result.items.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("falls back to a stable order when a field sort names no field", () => {
    const items = [dated("old", "2026-01-01T00:00:00.000Z"), dated("new", "2026-06-01T00:00:00.000Z")];
    expect(applyCmsQuery(query({ sort: "field-asc" }), items).items.map((entry) => entry.id)).toEqual(["new", "old"]);
  });

  it("falls back to updatedAt for an item with no publication date", () => {
    const items = [
      item({ id: "a", publishedAt: undefined, updatedAt: "2026-06-01T00:00:00.000Z" }),
      item({ id: "b", publishedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }),
    ];

    expect(applyCmsQuery(query({ sort: "newest" }), items).items.map((entry) => entry.id)).toEqual(["a", "b"]);
  });
});

describe("pagination", () => {
  const many = Array.from({ length: 7 }, (_, index) =>
    item({ id: `i${index}`, publishedAt: `2026-01-0${index + 1}T00:00:00.000Z` }),
  );

  it("returns one page and says whether more exist", () => {
    const first = applyCmsQuery(query({ limit: 3 }), many);

    expect(first.items).toHaveLength(3);
    expect(first.total).toBe(7);
    expect(first.hasMore).toBe(true);
  });

  it("moves through pages without repeating an item", () => {
    const first = applyCmsQuery(query({ limit: 3 }), many, { page: 1 });
    const second = applyCmsQuery(query({ limit: 3 }), many, { page: 2 });

    expect(second.items.map((entry) => entry.id)).not.toEqual(first.items.map((entry) => entry.id));
    expect(second.hasMore).toBe(true);
  });

  it("reports the last page as having no more", () => {
    expect(applyCmsQuery(query({ limit: 3 }), many, { page: 3 }).hasMore).toBe(false);
  });

  it("ignores the page when pagination is off", () => {
    const result = applyCmsQuery(query({ limit: 3, paginate: false }), many, { page: 2 });
    expect(result.items.map((entry) => entry.id)).toEqual(
      applyCmsQuery(query({ limit: 3, paginate: false }), many, { page: 1 }).items.map((entry) => entry.id),
    );
  });
});

describe("paths and orphans", () => {
  it("builds one item path in one place", () => {
    expect(cmsItemPath("case-studies", "acme")).toBe("/case-studies/acme");
    expect(cmsItemPath("Case Studies", "Acme Ltd")).toBe("/case-studies/acme-ltd");
  });

  it("reports a card still pointing at a removed field", () => {
    // Rendering blank instead would be a bug someone has to find by looking at the page.
    const element = {
      query: query(),
      cardFields: [
        { fieldId: "f-kept", display: "text" as const },
        { fieldId: "f-gone", display: "text" as const },
      ],
    };

    expect(orphanedCardFields(element, new Set(["f-kept"]))).toEqual(["f-gone"]);
  });
});
