import {
  createPage,
  createProjectDocument,
  DEFAULT_BLOG_SETTINGS,
  elementDefinition,
  postPath,
  type BuilderProject,
  type PublishedSiteVersion,
} from "@websitebuilder/shared";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { COLLECTIONS } from "../src/db/indexes";
import { createSeededWorkspaceResolver } from "../src/middleware/workspace";
import { createBlogRouter } from "../src/modules/blog/routes";
import { BlogRepository, ensureBlogIndexes } from "../src/modules/blog/repository";
import { ensureTemplateIndexes, TemplateRepository } from "../src/modules/blog/templates";
import { MediaRepository } from "../src/modules/media/repository";
import { createGridFsStorage } from "../src/modules/media/storage";
import { ProjectRepository, type WorkspaceContext } from "../src/modules/projects/repository";
import { ensurePublishingIndexes, PublishingRepository } from "../src/modules/publishing/repository";
import { PublishingService } from "../src/modules/publishing/service";
import { renderRouteHtml } from "../src/renderer/html";
import { testEnv, testLogger } from "./helpers";
import { startTestDatabase, type TestDatabase } from "./mongo";

/**
 * Writing a blog and putting it on a site, end to end.
 *
 * Every step here is one somebody performs in order, and each one used to be provable only in
 * isolation: a template that saved, a post that stored, a publication that succeeded. What the
 * customer reported was about the joins between them — the layout that never reached the page, the
 * post that was published and not on the site, the template save that overwrote the site.
 *
 * So these assert stored records and rendered HTML rather than the calls that produced them.
 */

const A: WorkspaceContext = { workspaceId: "workspace-a", userId: "user-a" };
const B: WorkspaceContext = { workspaceId: "workspace-b", userId: "user-b" };

let database: TestDatabase;
let projects: ProjectRepository;
let publishing: PublishingRepository;
let templates: TemplateRepository;
let blog: BlogRepository;
let service: PublishingService;
/** The blog API as another tenant reaches it: their session, this workspace's project id. */
let asOtherTenant: Express;

beforeAll(async () => {
  database = await startTestDatabase();
  projects = new ProjectRepository(database.db);
  publishing = new PublishingRepository(database.db, database.db.collection(COLLECTIONS.projects));
  blog = new BlogRepository(database.db);
  templates = new TemplateRepository(database.db);
  service = new PublishingService({
    projects,
    publishing,
    blog,
    media: new MediaRepository(database.db, createGridFsStorage(database.db)),
    // The published layouts, exactly as the server wires them: a template reaches the site at the
    // next publication of the site, not when it is saved.
    loadBlogTemplates: async (context, projectId) => {
      const [index, article] = await Promise.all([
        templates.loadOrCreate(context, projectId, "index"),
        templates.loadOrCreate(context, projectId, "article"),
      ]);
      return {
        ...(index.publishedDocument === undefined ? {} : { index: index.publishedDocument }),
        ...(article.publishedDocument === undefined ? {} : { article: article.publishedDocument }),
        fieldDefinitions: article.publishedFieldDefinitions,
      };
    },
    collectModuleFacts: async ({ workspaceId, projectId }) => {
      const context = { workspaceId, userId: "" };
      const settings = await blog.loadSettings(context, projectId);
      const [index, article] = await Promise.all([
        templates.loadOrCreate(context, projectId, "index"),
        templates.loadOrCreate(context, projectId, "article"),
      ]);
      const missing = [index, article].filter((template) => template.publishedDocument === undefined).length;
      return {
        blog: {
          hasRecords: (await blog.list(context, projectId, { perPage: 1 })).total > 0,
          explicitlyActivated: settings.enabled,
          blockingIssueCount: settings.enabled ? missing : 0,
          warningCount: 0,
        },
      };
    },
  });

  asOtherTenant = createApp({
    env: testEnv(),
    logger: testLogger(),
    routers: [
      {
        path: "/workspaces/:workspaceId/projects/:projectId/blog",
        router: createBlogRouter({
          repository: blog,
          templates,
          resolveWorkspace: createSeededWorkspaceResolver(B),
          // Wired exactly as the server wires it.
          projectExists: async (context, projectId) => (await projects.findById(context, projectId)) !== null,
        }),
      },
    ],
  });
}, 120_000);

afterAll(async () => {
  await database?.stop();
});

beforeEach(async () => {
  await database.clear();
  await ensureBlogIndexes(database.db);
  await ensureTemplateIndexes(database.db);
  await ensurePublishingIndexes(database.db);
});

/** A block bound to one of the post's own system fields, as the builder stores it. */
const boundTo = (field: string, display: string, id: string) => ({
  ...(elementDefinition("dynamicField").defaults() as Record<string, unknown>),
  id,
  name: "",
  type: "dynamicField",
  version: elementDefinition("dynamicField").schemaVersion,
  binding: { source: "system", field },
  display,
  geometry: { x: 0, y: 0, width: 480, height: 64, rotation: 0 },
  responsiveLayout: {
    width: { value: 480, unit: "px" },
    height: { value: 64, unit: "px" },
    horizontalConstraint: "left",
    verticalConstraint: "top",
    visible: true,
  },
  zIndex: 1,
  locked: false,
  hidden: false,
});

async function newProject(context: WorkspaceContext = A) {
  const project = await projects.create(context, { name: "Acme" });
  await blog.saveSettings(context, project.id, { ...DEFAULT_BLOG_SETTINGS, enabled: true });
  return project;
}

/** Designs a layout and publishes it, which is what makes it the one the site will compile. */
async function designAndPublishTemplate(projectId: string, kind: "index" | "article", elements: unknown[]) {
  const page = createPage({ name: kind === "index" ? "Blog index" : "Article" });
  page.sections[0]!.elements = elements as never;

  const template = await templates.loadOrCreate(A, projectId, kind);
  await templates.saveDraft(A, projectId, kind, { draftDocument: page, fieldDefinitions: [] }, template.draftVersion);
  await templates.publish(A, projectId, kind, []);
}

async function publishedVersion(projectId: string): Promise<PublishedSiteVersion> {
  const outcome = await service.publish(A, projectId);
  expect(outcome.status, JSON.stringify("report" in outcome ? outcome.report?.issues : outcome)).toBe("published");
  if (outcome.status !== "published") throw new Error("not published");
  return outcome.version as PublishedSiteVersion;
}

/** Renders one published route the way the public renderer does, from the snapshot alone. */
function renderPublished(version: PublishedSiteVersion, path: string): string {
  const route = version.routes.find((candidate) => candidate.path === path && candidate.statusCode === 200);
  expect(route, `no published route for ${path}`).toBeDefined();

  return renderRouteHtml({
    route: route!,
    document: version.document as BuilderProject,
    canonicalUrl: `https://acme.example.com${path}`,
    mediaBaseUrl: "/media",
    pageHref: (target) => target,
    ...(version.blog === undefined ? {} : { blog: version.blog }),
  });
}

describe("designing an article layout and putting it on the site", () => {
  it("renders the post through the blocks the designer placed", async () => {
    const project = await newProject();
    await designAndPublishTemplate(project.id, "index", []);
    await designAndPublishTemplate(project.id, "article", [
      boundTo("title", "heading", "the-title"),
      boundTo("content", "richText", "the-body"),
    ]);
    await blog.create(A, project.id, {
      title: "Release notes",
      slug: "release-notes",
      excerpt: "",
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "What changed." }] }] },
      categoryIds: [],
      tags: [],
      customFieldValues: {},
      status: "published",
    } as never);

    const version = await publishedVersion(project.id);
    const html = renderPublished(version, postPath(DEFAULT_BLOG_SETTINGS.basePath, "release-notes"));

    // The designed blocks, with the post's own values in them — not the built-in fallback article.
    expect(html).toContain("the-title");
    expect(html).toContain("Release notes");
    expect(html).toContain("What changed.");
  });

  it("publishes the index route with the post on it", async () => {
    const project = await newProject();
    await designAndPublishTemplate(project.id, "index", []);
    await designAndPublishTemplate(project.id, "article", [boundTo("title", "heading", "the-title")]);
    await blog.create(A, project.id, {
      title: "Release notes",
      slug: "release-notes",
      excerpt: "What changed",
      content: { type: "doc", content: [] },
      categoryIds: [],
      tags: [],
      customFieldValues: {},
      status: "published",
    } as never);

    const version = await publishedVersion(project.id);
    expect(renderPublished(version, DEFAULT_BLOG_SETTINGS.basePath)).toContain("Release notes");
  });

  it("refuses to publish a blog whose layouts were never published", async () => {
    const project = await newProject();

    // The routes would be live and empty. Blocking is the honest answer, and it is the state the
    // site card and the dashboard both report as needing attention.
    const outcome = await service.publish(A, project.id);
    expect(outcome.status).toBe("blocked");
    expect(await publishing.findActiveForProject(project.id)).toBeNull();
  });
});

describe("a blog change and the site that serves it", () => {
  it("keeps serving the published post until the site is published again", async () => {
    const project = await newProject();
    await designAndPublishTemplate(project.id, "index", []);
    await designAndPublishTemplate(project.id, "article", [boundTo("title", "heading", "the-title")]);
    const post = await blog.create(A, project.id, {
      title: "First title",
      slug: "release-notes",
      excerpt: "",
      content: { type: "doc", content: [] },
      categoryIds: [],
      tags: [],
      customFieldValues: {},
      status: "published",
    } as never);

    const first = await publishedVersion(project.id);
    expect(renderPublished(first, postPath(DEFAULT_BLOG_SETTINGS.basePath, "release-notes"))).toContain("First title");

    await blog.update(A, project.id, post.id, {
      title: "Second title",
      slug: "release-notes",
      excerpt: "",
      content: { type: "doc", content: [] },
      categoryIds: [],
      tags: [],
      customFieldValues: {},
      status: "published",
    } as never);

    // The snapshot is immutable by contract, so the live version cannot have changed under it.
    const stillLive = await publishing.findActiveForProject(project.id);
    expect(renderPublished(stillLive as PublishedSiteVersion, postPath(DEFAULT_BLOG_SETTINGS.basePath, "release-notes"))).toContain(
      "First title",
    );

    const second = await publishedVersion(project.id);
    expect(renderPublished(second, postPath(DEFAULT_BLOG_SETTINGS.basePath, "release-notes"))).toContain("Second title");
  });

  it("never puts a draft post on the site", async () => {
    const project = await newProject();
    await designAndPublishTemplate(project.id, "index", []);
    await designAndPublishTemplate(project.id, "article", [boundTo("title", "heading", "the-title")]);
    await blog.create(A, project.id, {
      title: "Not finished",
      slug: "not-finished",
      excerpt: "",
      content: { type: "doc", content: [] },
      categoryIds: [],
      tags: [],
      customFieldValues: {},
      status: "draft",
    } as never);

    const version = await publishedVersion(project.id);

    expect(version.blog?.posts.map((post) => post.slug)).not.toContain("not-finished");
    expect(version.routes.some((route) => route.path.endsWith("/not-finished"))).toBe(false);
  });

  it("keeps the layout being edited off the site until the template is published", async () => {
    const project = await newProject();
    await designAndPublishTemplate(project.id, "index", []);
    await designAndPublishTemplate(project.id, "article", [boundTo("title", "heading", "published-block")]);
    await blog.create(A, project.id, {
      title: "Release notes",
      slug: "release-notes",
      excerpt: "",
      content: { type: "doc", content: [] },
      categoryIds: [],
      tags: [],
      customFieldValues: {},
      status: "published",
    } as never);

    // A draft the designer is still working on.
    const draftPage = createPage({ name: "Article" });
    draftPage.sections[0]!.elements = [boundTo("title", "heading", "draft-only-block")] as never;
    const article = await templates.loadOrCreate(A, project.id, "article");
    await templates.saveDraft(
      A,
      project.id,
      "article",
      { draftDocument: draftPage, fieldDefinitions: [] },
      article.draftVersion,
    );

    const version = await publishedVersion(project.id);
    const html = renderPublished(version, postPath(DEFAULT_BLOG_SETTINGS.basePath, "release-notes"));

    expect(html).toContain("published-block");
    expect(html).not.toContain("draft-only-block");
  });
});

describe("a template save and the site's own document", () => {
  it("leaves the project document untouched", async () => {
    const project = await newProject();
    const before = await projects.findById(A, project.id);

    await designAndPublishTemplate(project.id, "article", [boundTo("title", "heading", "the-title")]);

    // The store is shared by the site builder and the template editor, and getting the target wrong
    // writes a person's site to the template endpoint or their template over a page.
    expect(await projects.findById(A, project.id)).toEqual(before);
  });

  it("leaves the template untouched when the site's document is saved", async () => {
    const project = await newProject();
    await designAndPublishTemplate(project.id, "article", [boundTo("title", "heading", "the-title")]);
    const before = await templates.loadOrCreate(A, project.id, "article");

    const loaded = await projects.findById(A, project.id);
    const { id, workspaceId, createdByUserId, revision, createdAt, updatedAt, ...document } = loaded!;
    (document as ReturnType<typeof createProjectDocument>).seo.siteName = "Renamed";
    await projects.saveDocument(A, project.id, revision, document as ReturnType<typeof createProjectDocument>);

    expect(await templates.loadOrCreate(A, project.id, "article")).toEqual(before);
  });
});

describe("another tenant", () => {
  it("cannot read, write or publish this workspace's blog", async () => {
    const project = await newProject();
    await designAndPublishTemplate(project.id, "index", []);
    await designAndPublishTemplate(project.id, "article", [boundTo("title", "heading", "the-title")]);
    const post = await blog.create(A, project.id, {
      title: "Release notes",
      slug: "release-notes",
      excerpt: "",
      content: { type: "doc", content: [] },
      categoryIds: [],
      tags: [],
      customFieldValues: {},
      status: "published",
    } as never);

    // The project id is a real id. What refuses is the workspace scope on every query, not the id.
    expect(await blog.findById(B, project.id, post.id)).toBeNull();
    expect(await blog.update(B, project.id, post.id, { title: "Theirs now" } as never)).toBeNull();
    expect((await blog.list(B, project.id, { perPage: 10 })).items).toEqual([]);
    expect((await service.publish(B, project.id)).status).toBe("not-found");

    // And nothing they did changed anything of A's.
    expect((await blog.findById(A, project.id, post.id))?.title).toBe("Release notes");
  });

  it("is told the project does not exist, rather than reaching its blog at all", async () => {
    const project = await newProject();
    await designAndPublishTemplate(project.id, "article", [boundTo("title", "heading", "the-title")]);
    await blog.create(A, project.id, {
      title: "Release notes",
      slug: "release-notes",
      excerpt: "",
      content: { type: "doc", content: [] },
      categoryIds: [],
      tags: [],
      customFieldValues: {},
      status: "published",
    } as never);

    /*
     * The project id is real and the collections beneath are not all keyed the same way: posts are
     * unique on `{projectId, slug}` and templates on `{projectId, kind}`, neither carrying the
     * workspace. So a tenant naming another's project id could take slugs out of their space, and
     * asking for a template answered with a duplicate-key failure rather than "no such project".
     */
    const paths = [
      `/api/v1/workspaces/${B.workspaceId}/projects/${project.id}/blog/templates/article`,
      `/api/v1/workspaces/${B.workspaceId}/projects/${project.id}/blog/posts`,
      `/api/v1/workspaces/${B.workspaceId}/projects/${project.id}/blog/settings`,
    ];

    for (const path of paths) {
      const response = await request(asOtherTenant).get(path);
      expect(response.status, path).toBe(404);
      expect(response.text, path).not.toContain("the-title");
    }

    // And the write path, which is the one that could have taken a slug.
    const created = await request(asOtherTenant)
      .post(`/api/v1/workspaces/${B.workspaceId}/projects/${project.id}/blog/posts`)
      .send({
        title: "Squatting the slug",
        slug: "release-notes",
        excerpt: "",
        content: { type: "doc", content: [] },
        categoryIds: [],
        tags: [],
        customFieldValues: {},
        status: "draft",
      });
    expect(created.status).toBe(404);
    expect((await blog.list(A, project.id, { perPage: 10 })).total).toBe(1);
  });
});
