import { describe, expect, it } from "vitest";

import {
  flattenChains,
  followChain,
  normalizeRedirectPath,
  redirectInputSchema,
  slugChangeRedirect,
  validateRedirect,
  type Redirect,
  type RedirectInput,
} from "./redirects";

const pages: Record<string, string> = { home: "/", about: "/about", contact: "/contact" };
const resolveDestinationPath = (destination: RedirectInput["destination"]): string | null =>
  destination.type === "internalPath" ? destination.path : (pages[destination.targetId] ?? null);

const rule = (sourcePath: string, path: string, id = sourcePath): Redirect => ({
  id,
  sourcePath,
  destination: { type: "internalPath", path },
  automatic: true,
  statusCode: 301,
});

describe("normalizeRedirectPath", () => {
  it("normalises leading slash, trailing slash, case, query and fragment", () => {
    expect(normalizeRedirectPath("About/")).toBe("/about");
    expect(normalizeRedirectPath("/About")).toBe("/about");
    expect(normalizeRedirectPath("/about?utm=x#top")).toBe("/about");
    expect(normalizeRedirectPath("/")).toBe("/");
  });

  it("refuses anything that could leave the origin", () => {
    for (const value of ["https://evil.example", "//evil.example", "/\\evil", "javascript:alert(1)", "mailto:a@b.c"]) {
      expect(normalizeRedirectPath(value)).toBeNull();
    }
  });

  it("refuses whitespace and control characters", () => {
    expect(normalizeRedirectPath("/a b")).toBeNull();
    expect(normalizeRedirectPath("")).toBeNull();
    expect(normalizeRedirectPath(`/a${String.fromCharCode(10)}b`)).toBeNull();
  });
});

describe("schema", () => {
  it("accepts every internal destination kind and rejects an external one", () => {
    expect(
      redirectInputSchema.safeParse({
        sourcePath: "/old",
        destination: { type: "internalPage", targetId: "about" },
        automatic: true,
      }).success,
    ).toBe(true);

    expect(
      redirectInputSchema.safeParse({
        sourcePath: "/old",
        destination: { type: "external", url: "https://evil.example" },
        automatic: false,
      }).success,
    ).toBe(false);
  });
});

describe("validateRedirect", () => {
  const validate = (candidate: RedirectInput, existing: Redirect[] = []) =>
    validateRedirect({ candidate, existing, resolveDestinationPath });

  it("accepts a straightforward rule", () => {
    expect(
      validate({ sourcePath: "/old-about", destination: { type: "internalPage", targetId: "about" }, automatic: true }),
    ).toEqual([]);
  });

  it("refuses a rule pointing at itself", () => {
    expect(
      validate({ sourcePath: "/about", destination: { type: "internalPage", targetId: "about" }, automatic: true }),
    ).toContainEqual({ code: "self-redirect" });
  });

  it("refuses a rule pointing at a page that no longer exists", () => {
    expect(
      validate({ sourcePath: "/old", destination: { type: "internalPage", targetId: "deleted" }, automatic: false }),
    ).toContainEqual({ code: "invalid-destination" });
  });

  it("refuses claiming a reserved path", () => {
    for (const source of ["/", "/sitemap.xml", "/robots.txt", "/api"]) {
      expect(
        validate({ sourcePath: source, destination: { type: "internalPage", targetId: "about" }, automatic: false }),
      ).toContainEqual({ code: "reserved-path" });
    }
  });

  it("refuses a duplicate source, however it was written", () => {
    const existing = [rule("/old", "/about")];
    expect(
      validate(
        { sourcePath: "/Old/", destination: { type: "internalPage", targetId: "contact" }, automatic: false },
        existing,
      ),
    ).toContainEqual({ code: "duplicate-source" });
  });

  it("refuses a rule that would create a loop", () => {
    const existing = [rule("/about", "/old")];
    expect(
      validate({ sourcePath: "/old", destination: { type: "internalPath", path: "/about" }, automatic: false }, existing),
    ).toContainEqual({ code: "loop" });
  });

  it("refuses a chain longer than the hop limit", () => {
    const existing = [rule("/a", "/b"), rule("/b", "/c"), rule("/c", "/d"), rule("/d", "/e"), rule("/e", "/f")];
    const issues = validate(
      { sourcePath: "/start", destination: { type: "internalPath", path: "/a" }, automatic: false },
      existing,
    );
    expect(issues.some((issue) => issue.code === "chain-too-long")).toBe(true);
  });

  it("refuses an invalid source outright, without reporting anything else", () => {
    expect(
      validate({
        sourcePath: "https://evil.example",
        destination: { type: "internalPage", targetId: "about" },
        automatic: false,
      }),
    ).toEqual([{ code: "invalid-source" }]);
  });
});

describe("followChain", () => {
  it("resolves through several hops", () => {
    const rules = [rule("/a", "/b"), rule("/b", "/c")];
    expect(followChain("/a", rules, { resolveDestinationPath })).toEqual({ kind: "resolved", path: "/c", hops: 2 });
  });

  it("detects a cycle rather than looping forever", () => {
    const rules = [rule("/a", "/b"), rule("/b", "/a")];
    expect(followChain("/a", rules, { resolveDestinationPath })).toEqual({ kind: "loop" });
  });

  it("stops at a rule whose destination no longer resolves", () => {
    const rules: Redirect[] = [
      { id: "1", sourcePath: "/a", destination: { type: "internalPage", targetId: "deleted" }, automatic: true, statusCode: 301 },
    ];
    expect(followChain("/a", rules, { resolveDestinationPath })).toEqual({ kind: "resolved", path: "/a", hops: 0 });
  });
});

describe("slugChangeRedirect", () => {
  it("creates an automatic rule when a slug changes", () => {
    expect(
      slugChangeRedirect({ previousPath: "/old-name", newPath: "/new-name", targetId: "p1", type: "internalPage" }),
    ).toEqual({
      sourcePath: "/old-name",
      destination: { type: "internalPage", targetId: "p1" },
      automatic: true,
    });
  });

  it("creates nothing when the paths are equivalent", () => {
    expect(
      slugChangeRedirect({ previousPath: "/about/", newPath: "/About", targetId: "p1", type: "internalPage" }),
    ).toBeNull();
  });
});

describe("flattenChains", () => {
  it("points every rule straight at its final destination", () => {
    const rules = [rule("/a", "/b", "1"), rule("/b", "/c", "2")];
    const flattened = flattenChains(rules, resolveDestinationPath);

    expect(flattened).toContainEqual({ id: "1", sourcePath: "/a", finalPath: "/c" });
    expect(flattened).toContainEqual({ id: "2", sourcePath: "/b", finalPath: "/c" });
  });

  it("drops a rule caught in a cycle rather than emitting a broken hop", () => {
    const rules = [rule("/a", "/b", "1"), rule("/b", "/a", "2")];
    expect(flattenChains(rules, resolveDestinationPath)).toEqual([]);
  });

  it("keeps a single-hop rule unchanged", () => {
    expect(flattenChains([rule("/old", "/about", "1")], resolveDestinationPath)).toEqual([
      { id: "1", sourcePath: "/old", finalPath: "/about" },
    ]);
  });
});
