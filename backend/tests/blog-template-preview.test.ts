import { createPage, elementDefinition, sampleBlogPosts } from "@websitebuilder/shared";
import type { Express } from "express";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { COLLECTIONS } from "../src/db/indexes";
import { createSeededWorkspaceResolver } from "../src/middleware/workspace";
import { BlogRepository, ensureBlogIndexes } from "../src/modules/blog/repository";
import { ensureTemplateIndexes, TemplateRepository } from "../src/modules/blog/templates";
import { MediaRepository } from "../src/modules/media/repository";
import { createMediaRouter } from "../src/modules/media/routes";
import { createGridFsStorage } from "../src/modules/media/storage";
import { ProjectRepository, type WorkspaceContext } from "../src/modules/projects/repository";
import { ensurePublishingIndexes, PUBLISHING_COLLECTIONS, PublishingRepository } from "../src/modules/publishing/repository";
import { createPublishingRouter } from "../src/modules/publishing/routes";
import { PublishingService } from "../src/modules/publishing/service";
import { DomainService } from "../src/modules/domains/service";
import { UnconfiguredHostnameProvider } from "../src/modules/domains/unconfiguredProvider";
import { testEnv, testLogger } from "./helpers";
import { startTestDatabase, type TestDatabase } from "./mongo";

/**
 * Previewing a blog layout.
 *
 * The template editor used to open the site's ordinary preview, so a designer who had just built an
 * article layout was shown the home page. Even pointed at the right address it would not have
 * helped: a template is a layout with holes in it, and a blog with nothing written has no record to
 * fill them — the article route does not exist and the index renders empty, which are precisely the
 * states a layout is designed in.
 *
 * So this route renders the layout against representative posts, through the renderer publication
 * uses, and writes nothing.
 */

const WORKSPACE = "workspace-a";
const OTHER = "workspace-b";
const A: WorkspaceContext = { workspaceId: WORKSPACE, userId: "user-a" };
const B: WorkspaceContext = { workspaceId: OTHER, userId: "user-b" };

let database: TestDatabase;
let projects: ProjectRepository;
let templates: TemplateRepository;
let blog: BlogRepository;
let media: MediaRepository;
let app: Express;

const templatePreview = (workspaceId: string, projectId: string, kind: string) =>
  `/api/v1/workspaces/${workspaceId}/projects/${projectId}/publishing/preview/blog-template/${kind}`;

beforeAll(async () => {
  database = await startTestDatabase();
  projects = new ProjectRepository(database.db);
  const publishing = new PublishingRepository(database.db, database.db.collection(COLLECTIONS.projects));
  blog = new BlogRepository(database.db);
  templates = new TemplateRepository(database.db);
  const domains = new DomainService(database.db, new UnconfiguredHostnameProvider(), "example.test");
  media = new MediaRepository(database.db, createGridFsStorage(database.db));

  app = createApp({
    env: testEnv(),
    logger: testLogger(),
    routers: [
      {
        path: "/workspaces/:workspaceId/media",
        router: createMediaRouter({
          repository: media,
          resolveWorkspace: createSeededWorkspaceResolver(A),
        }),
      },
      {
        path: "/workspaces/:workspaceId/projects/:projectId/publishing",
        router: createPublishingRouter({
          service: new PublishingService({
            projects,
            publishing,
            blog,
            media,
            // What publication reads: the published layout, wired here so the test can prove the
            // preview does *not* use it.
            loadBlogTemplates: async (context, projectId) => {
              const article = await templates.loadOrCreate(context, projectId, "article");
              return article.publishedDocument === undefined ? {} : { article: article.publishedDocument };
            },
            loadBlogTemplateDrafts: async (context, projectId) => {
              const [index, article] = await Promise.all([
                templates.loadOrCreate(context, projectId, "index"),
                templates.loadOrCreate(context, projectId, "article"),
              ]);
              return { index: index.draftDocument, article: article.draftDocument };
            },
          }),
          repository: publishing,
          domains,
          resolveWorkspace: createSeededWorkspaceResolver(A),
          platformRootDomain: "example.test",
          reservedSubdomains: [],
          publicOrigin: "https://app.example.test",
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

async function seedProject(context: WorkspaceContext = A) {
  const project = await projects.create(context, { name: "Acme" });
  const loaded = await projects.findById(context, project.id);
  return { projectId: project.id, revision: loaded!.revision };
}

/** A block bound to one of the post's own fields, as the builder stores it. */
const bound = (binding: unknown, display: string, id: string) => ({
  ...(elementDefinition("dynamicField").defaults() as Record<string, unknown>),
  id,
  name: "",
  type: "dynamicField",
  version: elementDefinition("dynamicField").schemaVersion,
  binding,
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

/** An article layout binding every field the preview is required to show. */
function articleLayout() {
  const page = createPage({ name: "Article" });
  page.sections[0]!.elements = [
    bound({ source: "system", field: "title" }, "heading", "the-title") as never,
    bound({ source: "system", field: "author" }, "text", "the-author") as never,
    bound({ source: "system", field: "publishedAt" }, "text", "the-date") as never,
    bound({ source: "system", field: "cover" }, "image", "the-cover") as never,
    bound({ source: "system", field: "content" }, "richText", "the-body") as never,
  ];
  return page;
}

async function designArticle(projectId: string, page = articleLayout()) {
  const template = await templates.loadOrCreate(A, projectId, "article");
  await templates.saveDraft(A, projectId, "article", { draftDocument: page, fieldDefinitions: [] }, template.draftVersion);
}

describe("previewing the article layout", () => {
  it("draws the designed blocks with a post in them, on a blog with nothing written", async () => {
    const { projectId } = await seedProject();
    await designArticle(projectId);

    const response = await request(app).get(templatePreview(WORKSPACE, projectId, "article")).query({ lang: "en-US" });
    const sample = sampleBlogPosts("en-US")[0]!;

    // No post exists, so the real article route does not exist either. This is the state a layout
    // is designed in, and it used to be the state in which it could not be looked at.
    expect(await blog.list(A, projectId, { perPage: 10 })).toMatchObject({ items: [] });
    expect(response.status).toBe(200);
    expect(response.text).toContain(sample.title);
    expect(response.text).toContain(sample.authorName);
    expect(response.text).toContain("This is a sample post");
    // The date is bound and rendered, not left as an empty box.
    expect(response.text).toContain(new Date(sample.publishedAt!).getFullYear().toString());
  });

  it("renders in the reader's language", async () => {
    const { projectId } = await seedProject();
    await designArticle(projectId);

    const response = await request(app).get(templatePreview(WORKSPACE, projectId, "article")).query({ lang: "pt-BR" });

    expect(response.text).toContain(sampleBlogPosts("pt-BR")[0]!.title);
    expect(response.text).not.toContain(sampleBlogPosts("en-US")[0]!.title);
  });

  it("shows a cover the workspace owns rather than a broken image", async () => {
    const { projectId } = await seedProject();
    await designArticle(projectId);
    await media.upload(A, {
      data: await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 9, g: 9, b: 9 } } })
        .png()
        .toBuffer(),
      filename: "cover.png",
      projectId,
    });

    const response = await request(app).get(templatePreview(WORKSPACE, projectId, "article"));
    const src = /src="([^"]*media[^"]*)"/.exec(response.text)?.[1];

    expect(src, "the cover should carry an image URL").toBeDefined();
    // A made-up media id would have produced an address that leads nowhere, which is the exact
    // failure a preview is supposed to help somebody avoid.
    expect((await request(app).get(src!)).status).toBe(200);
  });

  it("shows the layout being edited, not the one last published", async () => {
    const { projectId } = await seedProject();
    await designArticle(projectId);

    const response = await request(app).get(templatePreview(WORKSPACE, projectId, "article"));

    // Nothing has ever been published, so a preview reading the published document would render the
    // starter layout and none of these blocks.
    expect(response.text).toContain("the-title");
    expect(response.text).toContain("the-body");
  });
});

describe("previewing the index layout", () => {
  it("shows representative cards rather than an empty list", async () => {
    const { projectId } = await seedProject();

    const response = await request(app).get(templatePreview(WORKSPACE, projectId, "index")).query({ lang: "en-US" });

    expect(response.status).toBe(200);
    for (const post of sampleBlogPosts("en-US")) expect(response.text).toContain(post.title);
  });
});

describe("what the preview refuses and never changes", () => {
  it("rejects a template kind that does not exist", async () => {
    const { projectId } = await seedProject();

    const response = await request(app).get(templatePreview(WORKSPACE, projectId, "sidebar"));

    expect(response.status).toBe(400);
  });

  it("refuses a project belonging to another workspace", async () => {
    const other = await seedProject(B);

    const response = await request(app).get(templatePreview(WORKSPACE, other.projectId, "article"));

    expect(response.status).toBe(404);
    expect(response.text).not.toContain("data-page-id");
  });

  it("carries the draft policy: no indexing, no shared cache, no script from anywhere else", async () => {
    const { projectId } = await seedProject();
    await designArticle(projectId);

    const response = await request(app).get(templatePreview(WORKSPACE, projectId, "article"));

    expect(response.headers["x-robots-tag"]).toContain("noindex");
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors");
  });

  it("stores no sample post and publishes nothing", async () => {
    const { projectId } = await seedProject();
    await designArticle(projectId);

    await request(app).get(templatePreview(WORKSPACE, projectId, "article"));
    await request(app).get(templatePreview(WORKSPACE, projectId, "index"));

    // The sample exists for one render. A preview that wrote it would put content the customer
    // never authored into their own blog, and from there onto their live site.
    expect(await blog.list(A, projectId, { perPage: 10 })).toMatchObject({ items: [] });
    expect(await database.db.collection(PUBLISHING_COLLECTIONS.versions).countDocuments()).toBe(0);
  });

  it("goes through the same renderer as the site's own preview", async () => {
    const { projectId } = await seedProject();
    await designArticle(projectId);

    const template = await request(app).get(templatePreview(WORKSPACE, projectId, "article"));
    const site = await request(app).get(`/api/v1/workspaces/${WORKSPACE}/projects/${projectId}/publishing/preview`);

    // Same document scaffolding from the same renderer: a template preview drawn by a second
    // rendering path would stop predicting what publication does, which is its only purpose.
    for (const marker of ["<!doctype html>", "data-page-id", "<style"]) {
      expect(template.text, marker).toContain(marker);
      expect(site.text, marker).toContain(marker);
    }
  });
});
