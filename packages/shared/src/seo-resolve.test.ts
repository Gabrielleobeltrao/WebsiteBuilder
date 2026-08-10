import { describe, expect, it } from "vitest";

import { createDefaultPageSeo, createDefaultSiteSeo, type PageSeoSettings, type SiteSeoSettings } from "./seo";
import {
  applyTitleTemplate,
  auditMetadata,
  renderRobotsTxt,
  renderSitemap,
  resolveMetadata,
  sitemapEntries,
} from "./seo-resolve";

const site = (overrides: Partial<SiteSeoSettings> = {}): SiteSeoSettings => ({
  ...createDefaultSiteSeo("Acme"),
  defaultDescription: "A site about things that matter to our customers.",
  canonicalBaseUrl: "https://acme.example",
  ...overrides,
});

const page = (overrides: Partial<PageSeoSettings> = {}): PageSeoSettings => ({
  ...createDefaultPageSeo(),
  ...overrides,
});

const resolve = (overrides: { site?: Partial<SiteSeoSettings>; page?: Partial<PageSeoSettings>; path?: string } = {}) =>
  resolveMetadata({
    site: site(overrides.site),
    page: page(overrides.page),
    fallbackTitle: "About",
    path: overrides.path ?? "/about",
  });

describe("inheritance", () => {
  it("prefers the page override, then the site default, then the fallback", () => {
    expect(resolve({ page: { title: "Page title" } }).title).toContain("Page title");
    expect(resolve().title).toContain("About");
    expect(resolve({ page: { title: "" } }).description).toBe(site().defaultDescription);
  });

  it("does not let a page opt into indexing the site turned off", () => {
    const metadata = resolve({
      site: { defaultRobots: { index: false, follow: true } },
      page: { robots: { index: true, follow: true } },
    });
    expect(metadata.robots.index).toBe(false);
  });

  it("lets a page opt out even when the site allows indexing", () => {
    expect(resolve({ page: { robots: { index: false, follow: true } } }).robots.index).toBe(false);
  });

  it("falls back to the site social image and infers the card size from it", () => {
    expect(resolve({ site: { defaultSocialMediaId: "m1" } }).twitter.card).toBe("summary_large_image");
    expect(resolve({ site: { defaultSocialMediaId: undefined } }).twitter.card).toBe("summary");
  });

  it("uses the page's own social image over the site default", () => {
    const metadata = resolve({
      site: { defaultSocialMediaId: "site-image" },
      page: { openGraph: { mediaId: "page-image" } },
    });
    expect(metadata.openGraph.imageMediaId).toBe("page-image");
  });
});

describe("canonical URLs", () => {
  it("builds one from the configured base and the route path", () => {
    expect(resolve().canonicalUrl).toBe("https://acme.example/about");
  });

  it("honours a page-level canonical override", () => {
    expect(resolve({ page: { canonicalPath: "/canonical" } }).canonicalUrl).toBe("https://acme.example/canonical");
  });

  it("emits none rather than guessing when no base is configured", () => {
    expect(resolve({ site: { canonicalBaseUrl: undefined } }).canonicalUrl).toBeNull();
  });
});

describe("applyTitleTemplate", () => {
  it("substitutes both placeholders", () => {
    expect(applyTitleTemplate("%s | %site%", "About", "Acme")).toBe("About | Acme");
  });

  it("returns the site name when there is no title at all", () => {
    expect(applyTitleTemplate("%s | %site%", "", "Acme")).toBe("Acme");
  });

  it("tolerates a template that names no placeholder", () => {
    expect(applyTitleTemplate("Fixed", "About", "Acme")).toBe("About");
  });
});

describe("auditMetadata", () => {
  const route = (
    path: string,
    overrides: { title?: string; description?: string; index?: boolean; siteDescription?: string } = {},
  ) => ({
    path,
    metadata: resolveMetadata({
      site: site(overrides.siteDescription === undefined ? {} : { defaultDescription: overrides.siteDescription }),
      page: page({
        title: overrides.title ?? "A good page title",
        description: overrides.description ?? "A description long enough to be useful to a reader.",
        robots: { index: overrides.index ?? true, follow: true },
      }),
      fallbackTitle: path,
      path,
    }),
  });

  it("reports nothing for well-formed routes", () => {
    expect(auditMetadata([route("/a"), route("/b", { title: "Another good title" })])).toEqual([]);
  });

  it("reports a missing description as an error only when nothing fills it in", () => {
    // With a site default present the page inherits it, which is the correct outcome.
    expect(auditMetadata([route("/a", { description: "" })]).some((issue) => issue.code === "missing-description")).toBe(
      false,
    );

    const issues = auditMetadata([route("/a", { description: "", siteDescription: "" })]);
    expect(issues).toContainEqual({ code: "missing-description", severity: "error", path: "/a" });
  });

  it("reports a short description as a warning, not an error", () => {
    const issues = auditMetadata([route("/a", { description: "Too short." })]);
    expect(issues.find((issue) => issue.code === "short-description")?.severity).toBe("warning");
  });

  it("reports duplicate titles against every route that shares one", () => {
    const issues = auditMetadata([route("/a", { title: "Same" }), route("/b", { title: "Same" })]);
    const duplicates = issues.filter((issue) => issue.code === "duplicate-title");
    expect(duplicates.map((issue) => issue.path).sort()).toEqual(["/a", "/b"]);
  });

  it("surfaces noindex as information rather than a failure", () => {
    const issues = auditMetadata([route("/a", { index: false })]);
    expect(issues.find((issue) => issue.code === "noindex")?.severity).toBe("info");
  });

  it("warns when no canonical base is configured", () => {
    const noBase = {
      path: "/a",
      metadata: resolveMetadata({
        site: site({ canonicalBaseUrl: undefined }),
        page: page({ title: "T", description: "A description long enough to be useful to a reader." }),
        fallbackTitle: "T",
        path: "/a",
      }),
    };
    expect(auditMetadata([noBase]).some((issue) => issue.code === "missing-canonical-base")).toBe(true);
  });
});

describe("sitemap and robots", () => {
  const indexable = { path: "/a", metadata: resolve({ page: { title: "A" } }), lastModified: "2026-08-02" };
  const hidden = { path: "/b", metadata: resolve({ page: { title: "B", robots: { index: false, follow: true } } }) };

  it("excludes noindex routes, because listing one contradicts its own directive", () => {
    const entries = sitemapEntries([indexable, hidden]);
    expect(entries.map((entry) => entry.url)).toEqual(["https://acme.example/about"]);
  });

  it("excludes routes with no canonical URL", () => {
    const noBase = { path: "/c", metadata: resolve({ site: { canonicalBaseUrl: undefined } }) };
    expect(sitemapEntries([noBase])).toEqual([]);
  });

  it("renders valid XML and escapes every value", () => {
    const xml = renderSitemap([{ url: "https://acme.example/a?x=1&y=2", lastModified: "2026-08-02" }]);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("https://acme.example/a?x=1&amp;y=2");
    expect(xml).not.toContain("&y=2");
  });

  it("renders robots.txt reflecting the site's indexing choice", () => {
    expect(renderRobotsTxt({ allowIndexing: true, sitemapUrl: "https://acme.example/sitemap.xml" })).toContain(
      "Allow: /",
    );
    expect(renderRobotsTxt({ allowIndexing: false, sitemapUrl: null })).toContain("Disallow: /");
    expect(renderRobotsTxt({ allowIndexing: false, sitemapUrl: null })).not.toContain("Sitemap:");
  });
});

describe("stored defaults", () => {
  it("stores an English locale by default, like every other technical default", () => {
    // The published site's language is data the owner sets per site. Defaulting it to a specific
    // human language would put one country's assumption into every new project's database record.
    expect(createDefaultSiteSeo("Acme").locale).toBe("en-US");
  });

  it("keeps the site locale separate from the interface language", () => {
    // SiteSeoSettings.locale describes the published website; the user's own interface language is
    // a separate per-user preference and changing one must not change the other.
    const settings = createDefaultSiteSeo("Acme");
    expect(settings).not.toHaveProperty("interfaceLocale");
  });
});
