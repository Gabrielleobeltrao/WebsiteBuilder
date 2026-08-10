import { describe, expect, it } from "vitest";

import { buildSearchIndex, foldForSearch, MIN_QUERY_LENGTH, search, type SearchSource } from "./search";

const source = (overrides: Partial<SearchSource> = {}): SearchSource => ({
  kind: "page",
  id: "p1",
  title: "Our services",
  body: "We build websites for small businesses across the country.",
  path: "/services",
  indexable: true,
  published: true,
  ...overrides,
});

describe("index exclusions", () => {
  it("excludes unpublished content", () => {
    const index = buildSearchIndex([source({ published: false })]);
    expect(index).toHaveLength(0);
  });

  it("excludes noindex content", () => {
    const index = buildSearchIndex([source({ indexable: false })]);
    expect(index).toHaveLength(0);
  });

  it("excludes at index time, so a draft cannot reappear through a display filter", () => {
    const index = buildSearchIndex([
      source({ id: "public" }),
      source({ id: "draft", title: "Secret plans", published: false }),
    ]);

    // The draft's text is not in the index at all — not merely filtered out of results.
    expect(index.some((document) => document.haystack.includes("secret"))).toBe(false);
    expect(search(index, "secret").total).toBe(0);
  });

  it("indexes pages, posts and CMS items alike", () => {
    const index = buildSearchIndex([
      source({ kind: "page", id: "a" }),
      source({ kind: "post", id: "b", title: "A post" }),
      source({ kind: "cmsItem", id: "c", title: "An item" }),
    ]);
    expect(index.map((document) => document.kind).sort()).toEqual(["cmsItem", "page", "post"]);
  });
});

describe("query handling", () => {
  const index = buildSearchIndex([
    source({ id: "a", title: "Our services", body: "Websites for small businesses." }),
    source({ id: "b", title: "About us", body: "We are a small studio building websites." }),
    source({ id: "c", title: "Contact", body: "Get in touch." }),
  ]);

  it("returns nothing for a query below the minimum length", () => {
    expect(search(index, "a").total).toBe(0);
    expect(search(index, "").total).toBe(0);
    expect(MIN_QUERY_LENGTH).toBeGreaterThan(1);
  });

  it("matches on title and body", () => {
    expect(search(index, "services").results.map((r) => r.id)).toEqual(["a"]);
    expect(search(index, "touch").results.map((r) => r.id)).toEqual(["c"]);
  });

  it("ignores accents and case", () => {
    const accented = buildSearchIndex([source({ id: "x", title: "Nossos Serviços" })]);
    expect(search(accented, "servicos").total).toBe(1);
    expect(search(accented, "SERVIÇOS").total).toBe(1);
  });

  it("ranks documents matching every term above partial matches", () => {
    const results = search(index, "small websites").results;
    expect(results[0]?.id).toBe("b");
  });

  it("ranks a title match above a body-only match", () => {
    const titled = buildSearchIndex([
      source({ id: "body", title: "Other", body: "mentions pricing once" }),
      source({ id: "title", title: "Pricing", body: "unrelated text" }),
    ]);
    expect(search(titled, "pricing").results[0]?.id).toBe("title");
  });

  it("caps an absurdly long query instead of scanning it", () => {
    const response = search(index, "x".repeat(5000));
    expect(response.query.length).toBeLessThanOrEqual(120);
  });

  it("paginates and reports the true total", () => {
    const many = buildSearchIndex(
      Array.from({ length: 12 }, (_, index) => source({ id: `id-${index}`, title: `Websites ${index}` })),
    );
    const page = search(many, "websites", { perPage: 5, page: 2 });

    expect(page.results).toHaveLength(5);
    expect(page.total).toBe(12);
  });
});

describe("results", () => {
  it("exposes only what a visitor needs, never the internal haystack", () => {
    const index = buildSearchIndex([source()]);
    const result = search(index, "services").results[0];

    expect(Object.keys(result ?? {}).sort()).toEqual(["excerpt", "id", "kind", "path", "title"]);
  });

  it("trims an excerpt rather than returning a whole page", () => {
    const long = buildSearchIndex([source({ body: "word ".repeat(200) })]);
    expect(long[0]?.excerpt.length).toBeLessThanOrEqual(161);
    expect(long[0]?.excerpt.endsWith("…")).toBe(true);
  });

  it("collapses whitespace in the excerpt", () => {
    const messy = buildSearchIndex([source({ body: "one   two\n\nthree" })]);
    expect(messy[0]?.excerpt).toBe("one two three");
  });
});

describe("foldForSearch", () => {
  it("folds accents and case consistently", () => {
    expect(foldForSearch("Serviços Ágeis")).toBe("servicos ageis");
  });
});
