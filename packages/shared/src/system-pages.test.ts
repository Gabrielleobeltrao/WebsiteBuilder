import { describe, expect, it } from "vitest";

import {
  createDefaultSystemPage,
  resolveSystemBinding,
  SYSTEM_PAGE_CONTRACTS,
  SYSTEM_PAGE_KINDS,
  validateSystemPages,
} from "./system-pages";

describe("contracts", () => {
  it("keeps a 404 answering 404 however it is designed", () => {
    // A not-found page that answers 200 is invisible to search engines and to monitoring alike.
    expect(SYSTEM_PAGE_CONTRACTS.notFound.statusCode).toBe(404);
  });

  it("answers 200 for a search page, because the page exists even when the results do not", () => {
    expect(SYSTEM_PAGE_CONTRACTS.searchResults.statusCode).toBe(200);
  });

  it("answers 503 for maintenance, so crawlers come back rather than dropping the site", () => {
    expect(SYSTEM_PAGE_CONTRACTS.maintenance.statusCode).toBe(503);
  });

  it("keeps every system page out of the index", () => {
    for (const kind of SYSTEM_PAGE_KINDS) {
      expect(SYSTEM_PAGE_CONTRACTS[kind].indexable).toBe(false);
    }
  });
});

describe("validation", () => {
  it("accepts a system page with a path nothing else claims", () => {
    expect(validateSystemPages({ pages: [{ kind: "notFound" }], ordinaryPaths: new Set(["/about"]) })).toEqual([]);
  });

  it("reports an ordinary page claiming a system path", () => {
    const issues = validateSystemPages({ pages: [{ kind: "notFound" }], ordinaryPaths: new Set(["/404"]) });
    expect(issues).toEqual([{ code: "route-conflict", kind: "notFound", path: "/404" }]);
  });

  it("reports a binding the page's kind has no value for", () => {
    const issues = validateSystemPages({
      pages: [{ kind: "thankYou", usedBindings: ["query"] }],
      ordinaryPaths: new Set(),
    });

    expect(issues).toEqual([{ code: "unknown-binding", kind: "thankYou", binding: "query" }]);
  });

  it("accepts a binding the kind does own", () => {
    const issues = validateSystemPages({
      pages: [{ kind: "searchResults", usedBindings: ["query", "resultCount"] }],
      ordinaryPaths: new Set(),
    });

    expect(issues).toEqual([]);
  });

  it("refuses to let a system page into the index", () => {
    const issues = validateSystemPages({
      pages: [{ kind: "emptyResults", indexable: true }],
      ordinaryPaths: new Set(),
    });

    expect(issues).toEqual([{ code: "indexable-system-page", kind: "emptyResults" }]);
  });

  it("has no operation that deletes one", () => {
    // Every kind is always present; the check above is about misconfiguration, not absence.
    expect(Object.keys(SYSTEM_PAGE_CONTRACTS).sort()).toEqual([...SYSTEM_PAGE_KINDS].sort());
  });
});

describe("bindings", () => {
  it("resolves the values its own kind owns", () => {
    expect(resolveSystemBinding("notFound", "requestedPath", { requestedPath: "/missing" })).toBe("/missing");
    expect(resolveSystemBinding("searchResults", "resultCount", { resultCount: 12 })).toBe("12");
  });

  it("returns blank for a binding belonging to another kind", () => {
    // A template copied between kinds degrades to empty rather than showing a value from the wrong
    // context.
    expect(resolveSystemBinding("thankYou", "requestedPath", { requestedPath: "/missing" })).toBe("");
  });

  it("returns blank rather than undefined when the context is missing a value", () => {
    expect(resolveSystemBinding("searchResults", "query", {})).toBe("");
  });
});

describe("defaults", () => {
  it("creates a page that is safe before anyone designs it", () => {
    const page = createDefaultSystemPage("notFound", { title: "Page not found", description: "" });

    expect(page.kind).toBe("notFound");
    expect(page.sections).toEqual([]);
    expect(page.seo.title).toBe("Page not found");
  });
});
