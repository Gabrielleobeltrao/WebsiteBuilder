import { describe, expect, it } from "vitest";

import { createDefaultSiteSeo, type SiteSeoSettings } from "./seo";
import { buildArticleStructuredData, resolvePostMetadata, serializeStructuredData } from "./seo-blog";

const site = (overrides: Partial<SiteSeoSettings> = {}): SiteSeoSettings => ({
  ...createDefaultSiteSeo("Acme"),
  defaultDescription: "A site about things.",
  canonicalBaseUrl: "https://acme.example",
  ...overrides,
});

const post = (overrides: Record<string, unknown> = {}) => ({
  title: "Release notes",
  excerpt: "What changed this month for our customers.",
  status: "published" as const,
  ...overrides,
});

describe("resolvePostMetadata", () => {
  it("derives title and description from the post", () => {
    const metadata = resolvePostMetadata({ site: site(), post: post(), path: "/blog/release-notes" });

    expect(metadata.title).toContain("Release notes");
    expect(metadata.description).toBe("What changed this month for our customers.");
  });

  it("lets a per-post SEO override win", () => {
    const metadata = resolvePostMetadata({
      site: site(),
      post: post({ seoTitle: "Custom title", seoDescription: "Custom description" }),
      path: "/blog/x",
    });

    expect(metadata.title).toContain("Custom title");
    expect(metadata.description).toBe("Custom description");
  });

  it("produces distinct metadata for two posts rendered by one template", () => {
    const first = resolvePostMetadata({ site: site(), post: post({ title: "First" }), path: "/blog/first" });
    const second = resolvePostMetadata({ site: site(), post: post({ title: "Second" }), path: "/blog/second" });

    expect(first.title).not.toBe(second.title);
    expect(first.canonicalUrl).toBe("https://acme.example/blog/first");
    expect(second.canonicalUrl).toBe("https://acme.example/blog/second");
  });

  it("keeps a draft out of the index whatever the site default says", () => {
    const metadata = resolvePostMetadata({
      site: site({ defaultRobots: { index: true, follow: true } }),
      post: post({ status: "draft" }),
      path: "/blog/secret",
    });
    expect(metadata.robots.index).toBe(false);
  });

  it("marks a post as an article for social and structured data", () => {
    const metadata = resolvePostMetadata({ site: site(), post: post(), path: "/blog/x" });
    expect(metadata.openGraph.type).toBe("article");
    expect(metadata.structuredDataType).toBe("Article");
  });

  it("uses the cover image as the social image, falling back to the site default", () => {
    expect(resolvePostMetadata({ site: site(), post: post({ coverMediaId: "m1" }), path: "/b" }).openGraph.imageMediaId).toBe(
      "m1",
    );
    expect(
      resolvePostMetadata({ site: site({ defaultSocialMediaId: "site" }), post: post(), path: "/b" }).openGraph
        .imageMediaId,
    ).toBe("site");
  });
});

describe("buildArticleStructuredData", () => {
  const metadata = resolvePostMetadata({ site: site(), post: post(), path: "/blog/release-notes" });

  it("emits nothing for a draft, so hidden content is not advertised", () => {
    expect(
      buildArticleStructuredData({
        metadata,
        post: post({ status: "draft" }),
        site: site(),
      }),
    ).toBeNull();
  });

  it("includes the canonical URL, author and publication date when present", () => {
    const data = buildArticleStructuredData({
      metadata,
      post: post({ authorName: "Ana", publishedAt: "2026-08-02T00:00:00.000Z" }),
      site: site(),
      imageUrl: "https://acme.example/img.webp",
    });

    expect(data).toMatchObject({
      "@type": "Article",
      author: { "@type": "Person", name: "Ana" },
      datePublished: "2026-08-02T00:00:00.000Z",
      image: "https://acme.example/img.webp",
      mainEntityOfPage: "https://acme.example/blog/release-notes",
    });
  });

  it("omits fields that have no value instead of emitting empty ones", () => {
    const data = buildArticleStructuredData({ metadata, post: post(), site: site() });
    expect(data).not.toHaveProperty("author");
    expect(data).not.toHaveProperty("datePublished");
    expect(data).not.toHaveProperty("image");
  });

  it("names the organisation as publisher, falling back to the site name", () => {
    expect(buildArticleStructuredData({ metadata, post: post(), site: site() })?.publisher?.name).toBe("Acme");
    expect(
      buildArticleStructuredData({
        metadata,
        post: post(),
        site: site({ organization: { name: "Acme Ltd" } }),
      })?.publisher?.name,
    ).toBe("Acme Ltd");
  });
});

describe("serializeStructuredData", () => {
  it("escapes characters that could close the surrounding script element", () => {
    const output = serializeStructuredData({ headline: "</script><img src=x onerror=alert(1)>" });

    expect(output).not.toContain("</script>");
    expect(output).not.toContain("<img");
    expect(output).toContain("\\u003c");
  });

  it("escapes ampersands so an entity cannot be reconstructed", () => {
    expect(serializeStructuredData({ a: "x&y" })).toContain("\\u0026");
  });

  it("still parses back to the same data", () => {
    const data = { headline: "Title & <tag>", nested: { n: 1 } };
    expect(JSON.parse(serializeStructuredData(data))).toEqual(data);
  });
});
