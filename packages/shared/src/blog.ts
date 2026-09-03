import { z } from "zod";

import { normalizePageSlug } from "./slug";

/**
 * Blog contracts.
 *
 * Two rules drive the shape of everything here:
 *
 * 1. Custom field values are keyed by a stable field **ID**, never by the editable label. Renaming
 *    "Subtitle" to "Kicker" must not lose a single post's content.
 * 2. Rich text is validated structured JSON, never raw HTML. Storing HTML as the source of truth
 *    would make every published post an injection surface served from one shared renderer.
 */

export const BLOG_FIELD_TYPES = ["shortText", "longText", "richText", "image", "gallery", "link", "date"] as const;
export type BlogFieldType = (typeof BLOG_FIELD_TYPES)[number];

export const blogFieldDefinitionSchema = z
  .object({
    /** Stable for the field's whole life. Never derived from the label. */
    id: z.string().min(1),
    key: z.string().min(1).max(60),
    label: z.string().min(1).max(120),
    type: z.enum(BLOG_FIELD_TYPES),
    required: z.boolean(),
    helpText: z.string().max(300).optional(),
    defaultValue: z.unknown().optional(),
  })
  .strict();

export type BlogFieldDefinition = z.infer<typeof blogFieldDefinitionSchema>;

export const SYSTEM_BINDING_FIELDS = [
  "title",
  "excerpt",
  "cover",
  "content",
  "author",
  "publishedAt",
  "category",
] as const;

/**
 * The system fields a post can actually supply a value for today.
 *
 * A subset of `SYSTEM_BINDING_FIELDS` on purpose. The schema keeps accepting every one of them —
 * a stored template must not stop validating, and the set will grow as the post editor does — but a
 * template designer is only offered the ones a post can fill. `category` is the one left out: it
 * exists on the record and nothing anywhere in the product writes it, so binding a block to it is
 * choosing a box that is guaranteed to render nothing. `cover` was in the same state until the post
 * editor grew a picker for it.
 *
 * `publishedAt` is here despite not being typed by anyone: publishing sets it, so a post genuinely
 * carries one. The test beside this asserts every field named here resolves for a real post, which
 * is what keeps the list honest as the editor grows.
 */
export const RESOLVABLE_BINDING_FIELDS = ["title", "excerpt", "cover", "content", "author", "publishedAt"] as const;

export type ResolvableBindingField = (typeof RESOLVABLE_BINDING_FIELDS)[number];

export const dynamicBindingSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("system"), field: z.enum(SYSTEM_BINDING_FIELDS) }).strict(),
  z.object({ source: z.literal("custom"), fieldId: z.string().min(1) }).strict(),
]);

export type DynamicBinding = z.infer<typeof dynamicBindingSchema>;

/**
 * How a blog presents itself to a reader.
 *
 * A format is a *choice*, made once when the blog is turned on and changeable afterwards. It is
 * deliberately a small closed set rather than a layout editor: what a blog index needs to decide is
 * how much of each post to show and how many fit across, and every answer beyond those three is a
 * page somebody should be designing rather than configuring.
 *
 * The surrounding page — headings, spacing, anything the site puts around its articles — is the
 * index and article *templates*, which are ordinary builder pages.
 */
export const BLOG_FORMATS = ["list", "grid", "magazine"] as const;
export type BlogFormat = (typeof BLOG_FORMATS)[number];

/** How many posts sit across one row, per format. One means a stack. */
export const BLOG_FORMAT_COLUMNS: Record<BlogFormat, number> = { list: 1, grid: 3, magazine: 2 };

/** Whether the format leads with one post shown larger than the rest. */
export const BLOG_FORMAT_HAS_LEAD: Record<BlogFormat, boolean> = { list: false, grid: false, magazine: true };

export const blogSettingsSchema = z
  .object({
    enabled: z.boolean(),
    basePath: z.string().regex(/^\/[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a lowercase path such as /blog"),
    /**
     * The reading format. Absent on a blog turned on before formats existed, which reads as `list`
     * — the arrangement that assumes least about what the posts contain.
     */
    format: z.enum(BLOG_FORMATS).optional(),
    indexTemplateId: z.string().min(1).optional(),
    articleTemplateId: z.string().min(1).optional(),
    defaultAuthorName: z.string().max(120).optional(),
    postsPerPage: z.number().int().min(1).max(48),
  })
  .strict();

export type BlogSettings = z.infer<typeof blogSettingsSchema>;

export const DEFAULT_BLOG_SETTINGS: BlogSettings = {
  enabled: false,
  basePath: "/blog",
  postsPerPage: 12,
};

export function blogFormatOf(settings: Pick<BlogSettings, "format">): BlogFormat {
  return settings.format ?? "list";
}

/**
 * Whether a blog can serve the routes it publishes.
 *
 * Both templates, because both routes exist: an index with no template and an article with no
 * template are the same failure — a published address that answers with an empty page. This is the
 * check publication gates on, and the one the activation screen exists to satisfy.
 */
export function blogSetupIssues(settings: BlogSettings): Array<"no-index-template" | "no-article-template"> {
  if (!settings.enabled) return [];

  const issues: Array<"no-index-template" | "no-article-template"> = [];
  if (settings.indexTemplateId === undefined) issues.push("no-index-template");
  if (settings.articleTemplateId === undefined) issues.push("no-article-template");
  return issues;
}

/**
 * Tiptap document validation.
 *
 * Only an allowlisted set of node and mark types survives. Anything else — including any node that
 * could carry executable content — is rejected rather than sanitised, because rejecting an unknown
 * shape is verifiable and stripping one is a guess.
 */
export const ALLOWED_RICH_TEXT_NODES = [
  "doc",
  "paragraph",
  "text",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "hardBreak",
] as const;

export const ALLOWED_RICH_TEXT_MARKS = ["bold", "italic", "strike", "code", "link"] as const;

/** Exported so a schema in another module can name the type its own inference depends on. */
export type RichTextNode = { type: string; content?: RichTextNode[]; marks?: Array<{ type: string }> };

export const richTextNodeSchema: z.ZodType<RichTextNode> = z.lazy(() =>
  z
    .object({
      type: z.enum(ALLOWED_RICH_TEXT_NODES),
      text: z.string().max(20_000).optional(),
      attrs: z.record(z.string(), z.unknown()).optional(),
      marks: z
        .array(z.object({ type: z.enum(ALLOWED_RICH_TEXT_MARKS), attrs: z.record(z.string(), z.unknown()).optional() }).strict())
        .optional(),
      content: z.array(richTextNodeSchema).optional(),
    })
    .strict(),
) as z.ZodType<RichTextNode>;

export const richTextDocumentSchema = z
  .object({ type: z.literal("doc"), content: z.array(richTextNodeSchema).optional() })
  .strict();

export type RichTextDocument = z.infer<typeof richTextDocumentSchema>;

export const EMPTY_RICH_TEXT: RichTextDocument = { type: "doc", content: [] };

export const BLOG_POST_STATUSES = ["draft", "published"] as const;
export type BlogPostStatus = (typeof BLOG_POST_STATUSES)[number];

export const blogPostInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    slug: z.string().max(160),
    excerpt: z.string().max(500),
    content: richTextDocumentSchema,
    coverMediaId: z.string().min(1).optional(),
    authorName: z.string().max(120).optional(),
    categoryIds: z.array(z.string().min(1)).max(20),
    tags: z.array(z.string().min(1).max(40)).max(30),
    /** Keyed by stable BlogFieldDefinition.id so a renamed label keeps its values. */
    customFieldValues: z.record(z.string(), z.unknown()),
    status: z.enum(BLOG_POST_STATUSES),
    seoTitle: z.string().max(200).optional(),
    seoDescription: z.string().max(400).optional(),
    publishedAt: z.string().optional(),
  })
  .strict();

export type BlogPostInput = z.infer<typeof blogPostInputSchema>;

export type BlogPost = BlogPostInput & {
  id: string;
  projectId: string;
  workspaceId: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export function normalizePostSlug(input: string): string {
  return normalizePageSlug(input);
}

/** Public path for a post, used by links, the sitemap and the route manifest. */
export function postPath(basePath: string, slug: string): string {
  return `${basePath.replace(/\/+$/, "")}/${slug}`;
}

export type FieldCompatibilityIssue =
  | { code: "required-field-missing"; fieldId: string; postIds: string[] }
  | { code: "field-removed"; fieldId: string; postIds: string[] }
  | { code: "type-changed"; fieldId: string; from: BlogFieldType; to: BlogFieldType; postIds: string[] };

/**
 * Compares a template's current field definitions against the ones already published, and reports
 * what would break. Publishing a template updates every existing post, so an added required field
 * with no value is a real content gap — the designer sees exactly which posts before committing.
 */
export function analyseFieldCompatibility(input: {
  previous: readonly BlogFieldDefinition[];
  next: readonly BlogFieldDefinition[];
  publishedPosts: ReadonlyArray<{ id: string; customFieldValues: Record<string, unknown> }>;
}): FieldCompatibilityIssue[] {
  const issues: FieldCompatibilityIssue[] = [];
  const previousById = new Map(input.previous.map((field) => [field.id, field]));
  const nextById = new Map(input.next.map((field) => [field.id, field]));

  for (const field of input.next) {
    if (!field.required) continue;
    const missing = input.publishedPosts
      .filter((post) => isEmptyValue(post.customFieldValues[field.id]))
      .map((post) => post.id);
    if (missing.length > 0) issues.push({ code: "required-field-missing", fieldId: field.id, postIds: missing });
  }

  for (const field of input.previous) {
    if (nextById.has(field.id)) continue;
    // Values are retained, not deleted: the report exists so removal is a decision, not an accident.
    const affected = input.publishedPosts
      .filter((post) => !isEmptyValue(post.customFieldValues[field.id]))
      .map((post) => post.id);
    if (affected.length > 0) issues.push({ code: "field-removed", fieldId: field.id, postIds: affected });
  }

  for (const field of input.next) {
    const before = previousById.get(field.id);
    if (before === undefined || before.type === field.type) continue;
    const affected = input.publishedPosts
      .filter((post) => !isEmptyValue(post.customFieldValues[field.id]))
      .map((post) => post.id);
    issues.push({ code: "type-changed", fieldId: field.id, from: before.type, to: field.type, postIds: affected });
  }

  return issues;
}

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Blocking issues stop a template publication; the rest are shown but do not block. */
export function blocksTemplatePublication(issue: FieldCompatibilityIssue): boolean {
  return issue.code === "required-field-missing";
}
