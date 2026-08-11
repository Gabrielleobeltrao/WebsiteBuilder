import { describe, expect, it } from "vitest";

import { DEFAULT_BLOG_SETTINGS, type BlogSettings } from "./blog";
import type { BuilderElement } from "./elements";
import { createEmptySection, createPage, createProjectDocument, type BuilderProject } from "./project";
import { compileSite, type CompileInput, type PublishableCollection, type PublishablePost } from "./publication";
import { SCHEMA_VERSION } from "./schema-version";
import type { Redirect } from "./redirects";

// One fixture, cloned per call: generated ids differ between calls, and a determinism test that
// compared two independently generated documents would be testing the id generator.
const BASE = createProjectDocument({ name: "Acme", slug: "acme" });

function project(overrides: Partial<BuilderProject> = {}): BuilderProject {
  return {
    ...structuredClone(BASE),
    id: "project-1",
    workspaceId: "workspace-a",
    createdByUserId: "user-a",
    revision: 7,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function input(overrides: Partial<CompileInput> = {}): CompileInput {
  return {
    project: project(),
    blog: { settings: DEFAULT_BLOG_SETTINGS, posts: [] },
    cms: { collections: [], items: [] },
    redirects: [],
    mediaExists: () => true,
    supportedSchemaVersion: SCHEMA_VERSION,
    moduleBlockers: 0,
    maxDocumentBytes: 5_000_000,
    ...overrides,
  };
}

const post = (overrides: Partial<PublishablePost> = {}): PublishablePost => ({
  id: "post-1",
  slug: "hello",
  title: "Hello",
  status: "published",
  updatedAt: "2026-01-02T00:00:00.000Z",
  ...overrides,
});

const blogOn: BlogSettings = { ...DEFAULT_BLOG_SETTINGS, enabled: true };

const collection = (overrides: Partial<PublishableCollection> = {}): PublishableCollection => ({
  id: "collection-1",
  name: "Projects",
  slug: "projects",
  fields: [],
  hasDetailRoute: true,
  hasPublishedTemplate: true,
  ...overrides,
});

describe("determinism", () => {
  it("produces the same content hash for the same revision", () => {
    const first = compileSite(input());
    const second = compileSite(input());

    expect(first.ok).toBe(true);
    expect(first.snapshot?.contentHash).toBe(second.snapshot?.contentHash);
  });

  it("changes the hash when the content changes", () => {
    const changed = project();
    changed.pages.push(createPage({ name: "About", slug: "about", order: 1 }));

    expect(compileSite(input()).snapshot?.contentHash).not.toBe(
      compileSite(input({ project: changed })).snapshot?.contentHash,
    );
  });

  it("does not change the hash when only the revision moves", () => {
    // A save that changed nothing observable must not look like a new publication.
    const bumped = project({ revision: 99, updatedAt: "2026-06-01T00:00:00.000Z" });

    expect(compileSite(input({ project: bumped })).snapshot?.contentHash).toBe(
      compileSite(input()).snapshot?.contentHash,
    );
  });

  it("orders media ids so the same source yields the same array", () => {
    const withMedia = project();
    withMedia.seo.defaultSocialMediaId = "media-z";
    withMedia.seo.organization = { name: "Acme", logoMediaId: "media-a" };

    expect(compileSite(input({ project: withMedia })).snapshot?.referencedMediaIds).toEqual(["media-a", "media-z"]);
  });
});

describe("route manifest", () => {
  it("maps the home page to / and others to their slug", () => {
    const withAbout = project();
    withAbout.pages.push(createPage({ name: "About", slug: "about", order: 1 }));

    const paths = compileSite(input({ project: withAbout })).snapshot?.routes.map((route) => route.path);
    expect(paths).toContain("/");
    expect(paths).toContain("/about");
  });

  it("always includes a 404 route that is not indexable", () => {
    const snapshot = compileSite(input()).snapshot;
    const notFound = snapshot?.routes.find((route) => route.kind === "system");

    expect(notFound?.statusCode).toBe(404);
    expect(snapshot?.sitemapPaths).not.toContain("/404");
  });

  it("adds blog routes only when the blog is enabled", () => {
    const off = compileSite(input({ blog: { settings: DEFAULT_BLOG_SETTINGS, posts: [post()] } }));
    expect(off.snapshot?.routes.some((route) => route.kind === "blogPost")).toBe(false);

    const on = compileSite(input({ blog: { settings: blogOn, posts: [post()] } }));
    expect(on.snapshot?.routes.map((route) => route.path)).toContain("/blog/hello");
  });

  it("excludes draft posts entirely", () => {
    const snapshot = compileSite(
      input({ blog: { settings: blogOn, posts: [post(), post({ id: "post-2", slug: "secret", status: "draft" })] } }),
    ).snapshot;

    // Absent, not merely unlisted: a draft with no route cannot be reached by guessing its slug.
    expect(JSON.stringify(snapshot?.routes)).not.toContain("secret");
  });

  it("excludes draft CMS items and collections without a detail route", () => {
    const items = [
      { id: "item-1", collectionId: "collection-1", slug: "live", status: "published" as const, values: {}, updatedAt: "x" },
      { id: "item-2", collectionId: "collection-1", slug: "wip", status: "draft" as const, values: {}, updatedAt: "x" },
    ];

    const routed = compileSite(input({ cms: { collections: [collection()], items } })).snapshot;
    expect(routed?.routes.map((route) => route.path)).toContain("/projects/live");
    expect(routed?.routes.map((route) => route.path)).not.toContain("/projects/wip");

    const dataOnly = compileSite(
      input({ cms: { collections: [collection({ hasDetailRoute: false })], items } }),
    ).snapshot;
    expect(dataOnly?.routes.some((route) => route.kind === "cmsItem")).toBe(false);
  });

  it("claims no item route until the collection's template has been published", () => {
    const items = [
      { id: "item-1", collectionId: "collection-1", slug: "live", status: "published" as const, values: {}, updatedAt: "x" },
    ];

    const unpublished = compileSite(
      input({ cms: { collections: [collection({ hasPublishedTemplate: false })], items } }),
    ).snapshot;

    // The list still exists; only the per-item pages wait for a template someone approved.
    expect(unpublished?.routes.some((route) => route.kind === "cmsList")).toBe(true);
    expect(unpublished?.routes.some((route) => route.kind === "cmsItem")).toBe(false);
  });

  it("blocks a route collision rather than publishing an ambiguous site", () => {
    const clashing = project();
    clashing.pages.push(createPage({ name: "Blog", slug: "blog", order: 1 }));

    const result = compileSite(input({ project: clashing, blog: { settings: blogOn, posts: [] } }));

    expect(result.ok).toBe(false);
    expect(result.snapshot).toBeNull();
    expect(result.report.issues.map((issue) => issue.code)).toContain("route-collision");
  });
});

describe("media", () => {
  it("blocks when a referenced image no longer exists", () => {
    const withImage = project();
    withImage.seo.defaultSocialMediaId = "deleted-media";

    const result = compileSite(input({ project: withImage, mediaExists: () => false }));

    expect(result.ok).toBe(false);
    expect(result.report.issues.map((issue) => issue.code)).toContain("missing-media");
  });

  it("ignores media referenced only by a draft post", () => {
    const snapshot = compileSite(
      input({
        blog: {
          settings: blogOn,
          posts: [post({ status: "draft", coverMediaId: "draft-cover" })],
        },
      }),
    ).snapshot;

    // Otherwise a draft would keep media alive forever and retention could never reclaim it.
    expect(snapshot?.referencedMediaIds).not.toContain("draft-cover");
  });

  it("collects images placed inside pages and shared sections", () => {
    const withSections = project();
    const image = (id: string, mediaId: string) =>
      ({
        id,
        type: "image",
        name: "Image",
        source: { kind: "media", mediaId },
        alt: "A description",
        decorative: false,
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
        style: { objectFit: "cover", borderRadius: 0 },
      }) as unknown as BuilderElement;

    withSections.pages[0]!.sections = [{ ...createEmptySection(), elements: [image("element-1", "media-page")] }];
    withSections.sharedSections = [
      { ...createEmptySection(), elements: [image("element-2", "media-shared")] },
    ];

    expect(compileSite(input({ project: withSections })).snapshot?.referencedMediaIds).toEqual([
      "media-page",
      "media-shared",
    ]);
  });
});

describe("failure atomicity", () => {
  it("returns no snapshot at all when anything blocks", () => {
    for (const broken of [
      input({ moduleBlockers: 2 }),
      input({ maxDocumentBytes: 10 }),
      input({ supportedSchemaVersion: SCHEMA_VERSION + 1 }),
    ]) {
      const result = compileSite(broken);
      expect(result.ok).toBe(false);
      expect(result.snapshot).toBeNull();
    }
  });

  it("reports the revision it compiled from so the caller can detect a concurrent save", () => {
    expect(compileSite(input()).report.sourceRevision).toBe(7);
  });
});

describe("redirects", () => {
  const redirect = (id: string, sourcePath: string, path: string): Redirect => ({
    id,
    sourcePath,
    destination: { type: "internalPath", path },
    automatic: false,
    statusCode: 301,
  });

  it("flattens a chain so a visitor makes one hop", () => {
    const snapshot = compileSite(
      input({ redirects: [redirect("r1", "/old", "/middle"), redirect("r2", "/middle", "/")] }),
    ).snapshot;

    expect(snapshot?.redirects.find((entry) => entry.sourcePath === "/old")?.destinationPath).toBe("/");
  });

  it("drops a redirect whose source is a real page", () => {
    const withAbout = project();
    withAbout.pages.push(createPage({ name: "About", slug: "about", order: 1 }));

    const snapshot = compileSite(
      input({ project: withAbout, redirects: [redirect("r1", "/about", "/")] }),
    ).snapshot;

    // Keeping it would make an existing page permanently unreachable.
    expect(snapshot?.redirects.some((entry) => entry.sourcePath === "/about")).toBe(false);
  });
});

describe("system pages", () => {
  it("claims a route for every system page that has a fixed path", () => {
    const snapshot = compileSite(input()).snapshot;
    const system = snapshot?.routes.filter((route) => route.kind === "system") ?? [];

    expect(system.map((route) => route.path).sort()).toEqual(["/404", "/search", "/thank-you"]);
  });

  it("keeps the 404 answering 404 and the others answering 200", () => {
    const system = compileSite(input()).snapshot?.routes.filter((route) => route.kind === "system") ?? [];

    expect(system.find((route) => route.path === "/404")?.statusCode).toBe(404);
    expect(system.find((route) => route.path === "/search")?.statusCode).toBe(200);
  });

  it("keeps every system page out of the sitemap", () => {
    const snapshot = compileSite(input()).snapshot;

    for (const path of ["/404", "/search", "/thank-you"]) {
      expect(snapshot?.sitemapPaths).not.toContain(path);
    }
  });

  it("reports a collision when an ordinary page claims a system path", () => {
    const clashing = project();
    clashing.pages.push(createPage({ name: "Search", slug: "search", order: 1 }));

    const result = compileSite(input({ project: clashing }));
    expect(result.ok).toBe(false);
    expect(result.report.issues.map((issue) => issue.code)).toContain("route-collision");
  });
});
