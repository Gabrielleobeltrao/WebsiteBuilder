import { describe, expect, it } from "vitest";

import {
  analyseFieldCompatibility,
  blocksTemplatePublication,
  blogPostInputSchema,
  blogSettingsSchema,
  DEFAULT_BLOG_SETTINGS,
  dynamicBindingSchema,
  EMPTY_RICH_TEXT,
  normalizePostSlug,
  postPath,
  RESOLVABLE_BINDING_FIELDS,
  richTextDocumentSchema,
  SYSTEM_BINDING_FIELDS,
  type BlogFieldDefinition,
} from "./blog";

const field = (overrides: Partial<BlogFieldDefinition> = {}): BlogFieldDefinition => ({
  id: "f1",
  key: "subtitle",
  label: "Subtitle",
  type: "shortText",
  required: false,
  ...overrides,
});

describe("rich text validation", () => {
  it("accepts an ordinary Tiptap document", () => {
    const document = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Hello" }] },
        { type: "paragraph", content: [{ type: "text", text: "Body", marks: [{ type: "bold" }] }] },
      ],
    };
    expect(richTextDocumentSchema.safeParse(document).success).toBe(true);
  });

  it("rejects a node type outside the allowlist rather than stripping it", () => {
    const document = { type: "doc", content: [{ type: "script", content: [] }] };
    expect(richTextDocumentSchema.safeParse(document).success).toBe(false);
  });

  it("rejects an unknown mark", () => {
    const document = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "onclick" }] }] }],
    };
    expect(richTextDocumentSchema.safeParse(document).success).toBe(false);
  });

  it("rejects raw HTML masquerading as content", () => {
    expect(richTextDocumentSchema.safeParse("<script>alert(1)</script>").success).toBe(false);
    expect(richTextDocumentSchema.safeParse({ type: "doc", html: "<b>x</b>" }).success).toBe(false);
  });

  it("rejects a document whose root is not a doc", () => {
    expect(richTextDocumentSchema.safeParse({ type: "paragraph" }).success).toBe(false);
  });

  it("accepts the empty document used for a new post", () => {
    expect(richTextDocumentSchema.safeParse(EMPTY_RICH_TEXT).success).toBe(true);
  });

  it("validates deeply nested content", () => {
    const document = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "iframe" }] }] },
          ],
        },
      ],
    };
    expect(richTextDocumentSchema.safeParse(document).success).toBe(false);
  });
});

describe("blog settings", () => {
  it("starts disabled with a sensible base path", () => {
    expect(DEFAULT_BLOG_SETTINGS.enabled).toBe(false);
    expect(blogSettingsSchema.safeParse(DEFAULT_BLOG_SETTINGS).success).toBe(true);
  });

  it("rejects a base path that is not a lowercase absolute segment", () => {
    for (const basePath of ["blog", "/Blog", "/blog/", "/blog posts", "//blog", "/blog?x=1"]) {
      expect(blogSettingsSchema.safeParse({ ...DEFAULT_BLOG_SETTINGS, basePath }).success).toBe(false);
    }
    expect(blogSettingsSchema.safeParse({ ...DEFAULT_BLOG_SETTINGS, basePath: "/news-and-updates" }).success).toBe(true);
  });
});

describe("post input", () => {
  const valid = {
    title: "Hello",
    slug: "hello",
    excerpt: "",
    content: EMPTY_RICH_TEXT,
    categoryIds: [],
    tags: [],
    customFieldValues: {},
    status: "draft" as const,
  };

  it("accepts a minimal draft", () => {
    expect(blogPostInputSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an empty title and unknown properties", () => {
    expect(blogPostInputSchema.safeParse({ ...valid, title: "   " }).success).toBe(false);
    expect(blogPostInputSchema.safeParse({ ...valid, isAdmin: true }).success).toBe(false);
  });

  it("rejects content that is not a validated document", () => {
    expect(blogPostInputSchema.safeParse({ ...valid, content: "<p>x</p>" }).success).toBe(false);
  });
});

describe("slug and path", () => {
  it("normalises a post slug the same way page slugs are normalised", () => {
    expect(normalizePostSlug("Nosso Primeiro Artigo!")).toBe("nosso-primeiro-artigo");
  });

  it("builds the public path without doubling separators", () => {
    expect(postPath("/blog", "hello")).toBe("/blog/hello");
    expect(postPath("/blog/", "hello")).toBe("/blog/hello");
  });
});

describe("analyseFieldCompatibility", () => {
  const posts = [
    { id: "p1", customFieldValues: { f1: "Set" } },
    { id: "p2", customFieldValues: {} },
    { id: "p3", customFieldValues: { f1: "   " } },
  ];

  it("reports exactly which published posts lack a newly required field", () => {
    const issues = analyseFieldCompatibility({
      previous: [field()],
      next: [field({ required: true })],
      publishedPosts: posts,
    });

    expect(issues).toEqual([{ code: "required-field-missing", fieldId: "f1", postIds: ["p2", "p3"] }]);
    expect(issues.every(blocksTemplatePublication)).toBe(true);
  });

  it("reports a removed field without treating it as blocking", () => {
    const issues = analyseFieldCompatibility({ previous: [field()], next: [], publishedPosts: posts });

    expect(issues).toEqual([{ code: "field-removed", fieldId: "f1", postIds: ["p1"] }]);
    expect(issues.some(blocksTemplatePublication)).toBe(false);
  });

  it("reports a type change and which posts hold a value in the old type", () => {
    const issues = analyseFieldCompatibility({
      previous: [field({ type: "shortText" })],
      next: [field({ type: "date" })],
      publishedPosts: posts,
    });

    expect(issues).toEqual([{ code: "type-changed", fieldId: "f1", from: "shortText", to: "date", postIds: ["p1"] }]);
  });

  it("reports nothing when a new field is optional, so adding one never blocks", () => {
    const issues = analyseFieldCompatibility({
      previous: [],
      next: [field({ id: "f2", required: false })],
      publishedPosts: posts,
    });
    expect(issues).toEqual([]);
  });

  it("keys everything by field id, so renaming a label changes nothing", () => {
    const issues = analyseFieldCompatibility({
      previous: [field({ label: "Subtitle" })],
      next: [field({ label: "Kicker" })],
      publishedPosts: posts,
    });
    expect(issues).toEqual([]);
  });
});

/**
 * The fields a template designer is offered, held to the ones a post can actually fill.
 *
 * `SYSTEM_BINDING_FIELDS` names everything the model has room for. The offer is narrower, because
 * `cover` and `category` have no field anywhere in the product that writes them — binding a block to
 * either would be choosing a box guaranteed to draw nothing, which is the failure this codebase
 * already keeps a whole suite for.
 *
 * This is the guard that keeps the two lists from drifting: when the post editor grows a cover
 * picker, the field belongs in the offer, and until then it must not be there.
 */
describe("what a template may bind to", () => {
  const filled = {
    title: "Hello world",
    excerpt: "A summary.",
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Body." }] }] },
    authorName: "Ana",
    coverMediaId: "aaaaaaaaaaaaaaaaaaaaaaaa",
    publishedAt: "2026-08-01T10:00:00.000Z",
  } as const;

  const valueOf: Record<string, unknown> = {
    title: filled.title,
    excerpt: filled.excerpt,
    content: filled.content,
    cover: filled.coverMediaId,
    author: filled.authorName,
    publishedAt: filled.publishedAt,
  };

  it("offers only fields a fully written post carries a value for", () => {
    for (const field of RESOLVABLE_BINDING_FIELDS) {
      expect(valueOf[field], field).toBeDefined();
    }
  });

  it("leaves out the fields nothing in the product writes", () => {
    // Nothing in the product writes a category, so offering it is offering nothing.
    expect(RESOLVABLE_BINDING_FIELDS).not.toContain("category");
  });

  it("stays a subset of what the schema accepts, so no stored template stops validating", () => {
    for (const field of RESOLVABLE_BINDING_FIELDS) {
      expect(SYSTEM_BINDING_FIELDS).toContain(field);
      expect(dynamicBindingSchema.safeParse({ source: "system", field }).success, field).toBe(true);
    }

    // And the wider set still parses: a template bound to a cover before this narrowing keeps working.
    expect(dynamicBindingSchema.safeParse({ source: "system", field: "cover" }).success).toBe(true);
  });
});
