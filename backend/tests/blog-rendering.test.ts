import {
  createPage,
  elementDefinition,
  normalizePublishablePost,
  buildRouteManifest,
  DEFAULT_BLOG_SETTINGS,
  type BlogSettings,
  type BuilderProject,
  type PublishableBlog,
  type PublishablePost,
} from "@websitebuilder/shared";
import { overriddenProject } from "@websitebuilder/shared/responsive-fixtures";
import { describe, expect, it } from "vitest";

import { renderRouteHtml } from "../src/renderer/html";

/**
 * The two routes a blog publishes.
 *
 * They existed before this and answered with an empty body: a blog route's `resourceId` is the
 * literal "blog-index" or a post id, and the renderer resolved a route by looking that id up among
 * the document's pages, where neither could ever be. Both addresses were live and blank.
 */
const settings: BlogSettings = { ...DEFAULT_BLOG_SETTINGS, enabled: true, format: "grid" };

const post = (overrides: Partial<PublishablePost> = {}): PublishablePost => ({
  id: "post-1",
  slug: "hello-world",
  title: "Hello world",
  excerpt: "The first thing we published.",
  status: "published",
  publishedAt: "2026-08-01T10:00:00.000Z",
  authorName: "Ana",
  updatedAt: "2026-08-01T10:00:00.000Z",
  content: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "The body of the article." }] }],
  } as unknown as PublishablePost["content"],
  ...overrides,
});

const blog = (overrides: Partial<PublishableBlog> = {}): PublishableBlog => ({
  settings,
  posts: [post()],
  ...overrides,
});

const project = () => overriddenProject() as BuilderProject;

function render(kind: "blogIndex" | "blogPost", published: PublishableBlog | undefined) {
  const document = project();
  const routes = buildRouteManifest({
    project: document,
    blog: { settings, posts: published?.posts ?? [] },
    cms: { collections: [], items: [] },
    redirects: [],
    mediaExists: () => true,
    supportedSchemaVersion: document.schemaVersion,
    moduleBlockers: 0,
    maxDocumentBytes: 10_000_000,
  } as never);

  const route = routes.find((candidate) => candidate.kind === kind);
  if (route === undefined) throw new Error(`no ${kind} route in the manifest`);

  return renderRouteHtml({
    route,
    document,
    canonicalUrl: "https://example.test/",
    mediaBaseUrl: "/api/v1/public/media",
    ...(published === undefined ? {} : { blog: published }),
  });
}

describe("the blog index", () => {
  it("renders the posts rather than an empty document", () => {
    const html = render("blogIndex", blog());

    expect(html).toContain("Hello world");
    expect(html).toContain("The first thing we published.");
    expect(html).toContain('href="/blog/hello-world"');
  });

  it("lays the posts out in the format the site chose", () => {
    const one = render("blogIndex", blog({ settings: { ...settings, format: "list" } }));
    const three = render("blogIndex", blog({ settings: { ...settings, format: "grid" } }));

    // A track floor rather than a media query, so the arrangement is true at every width.
    expect(one).toContain("minmax(min(1000px, 100%), 1fr)");
    expect(three).toContain("minmax(min(333px, 100%), 1fr)");
  });

  it("leads with one post in the magazine format and not in the others", () => {
    const magazine = render("blogIndex", blog({ settings: { ...settings, format: "magazine" }, posts: [post(), post({ id: "p2", slug: "second", title: "Second" })] }));
    expect(magazine).toContain("1.75em");

    const grid = render("blogIndex", blog({ posts: [post(), post({ id: "p2", slug: "second", title: "Second" })] }));
    expect(grid).not.toContain("1.75em");
  });
});

describe("one article", () => {
  it("renders the body the snapshot froze", () => {
    const html = render("blogPost", blog());

    expect(html).toContain("Hello world");
    expect(html).toContain("The body of the article.");
    expect(html).toContain("Ana");
  });

  it("never inserts the body as markup", () => {
    const html = render(
      "blogPost",
      blog({
        posts: [
          post({
            content: {
              type: "doc",
              content: [{ type: "paragraph", content: [{ type: "text", text: "<img src=x onerror=alert(1)>" }] }],
            } as unknown as PublishablePost["content"],
          }),
        ],
      }),
    );

    // Stored as text and rendered as a text node, which is what makes it harmless.
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
  });
});

describe("a version published before its blog carried anything", () => {
  it("renders nothing rather than a broken page", () => {
    // The route is in that snapshot and cannot be removed from it. An empty article is the honest
    // outcome until the site is republished.
    const html = render("blogIndex", undefined);
    expect(html).toContain("<!doctype html>");
    expect(html).not.toContain("Hello world");
  });
});

/**
 * What a post without every optional field produces.
 *
 * Mongo stores an unset optional as `null`, and these fields are declared `string | undefined`, so
 * `coverMediaId !== undefined` was true for a post that has no cover. Every published card and
 * article carried `<img src=".../null/content">` and a `preload` link in the head fetching that 404
 * before anything else on the page, and the byline printed a bare separator with no name in front
 * of it. Both are what a customer sees as "the blog is not working".
 */
/**
 * The band of nothing above every article.
 *
 * Activating a blog seeds both templates from `createPage`, which arrives with one 480px section and
 * nothing in it. Rendered above the article, that is half a screen of blank space before the first
 * word — the reason a working blog reads as a broken one.
 */
describe("a template nobody has filled in", () => {
  const emptyTemplate = () => createPage({ name: "Article" });

  it("takes up no space at all", () => {
    const html = render("blogPost", blog({ articleTemplate: emptyTemplate() }));

    expect(html).not.toContain("min-height:480px");
    expect(html).toContain("Hello world");
  });

  it("still renders a template that has something on it", () => {
    const filled = createPage({ name: "Article" });
    filled.sections[0]!.elements = [
      {
        ...(elementDefinition("text").defaults() as Record<string, unknown>),
        id: "masthead",
        name: "",
        type: "text",
        version: elementDefinition("text").schemaVersion,
        content: "From the newsroom",
        geometry: { x: 0, y: 0, width: 320, height: 64, rotation: 0 },
        responsiveLayout: {
          width: { value: 320, unit: "px" },
          height: { value: 64, unit: "px" },
          horizontalConstraint: "left",
          verticalConstraint: "top",
          visible: true,
        },
        zIndex: 1,
        locked: false,
        hidden: false,
      } as never,
    ];

    expect(render("blogPost", blog({ articleTemplate: filled }))).toContain("From the newsroom");
  });
});

describe("a post with nothing optional filled in", () => {
  const bare = () =>
    normalizePublishablePost({
      ...post(),
      // As Mongo hands them back, which is not what the type says.
      coverMediaId: null,
      authorName: null,
      excerpt: null,
    } as unknown as PublishablePost);

  it("renders no image at all rather than one pointing at nothing", () => {
    const html = render("blogPost", blog({ posts: [bare()] }));

    expect(html).not.toContain("/null/");
    expect(html).not.toContain("<img");
    // And nothing in the head asking the browser to fetch it early.
    expect(html).not.toContain('rel="preload"');
  });

  it("leaves out the byline instead of printing its punctuation", () => {
    const html = render("blogPost", blog({ posts: [bare()] }));

    expect(html).not.toContain(" · ");
    expect(html).toContain("Hello world");
  });

  it("keeps the fields that are actually set", () => {
    const html = render("blogPost", blog({ posts: [normalizePublishablePost(post())] }));

    expect(html).toContain("Ana");
    expect(html).toContain("The first thing we published.");
  });
});
