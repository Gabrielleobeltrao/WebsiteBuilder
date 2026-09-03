import { createProjectDocument, DEFAULT_FORM_PRESENTATION } from "@websitebuilder/shared";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { COLLECTIONS } from "../src/db/indexes";
import { BlogRepository, ensureBlogIndexes } from "../src/modules/blog/repository";
import { ensureTemplateIndexes, TemplateRepository } from "../src/modules/blog/templates";
import { repairBlogTemplates } from "../src/modules/blog/repair";
import { MediaRepository } from "../src/modules/media/repository";
import { createGridFsStorage } from "../src/modules/media/storage";
import { ProjectRepository, type WorkspaceContext } from "../src/modules/projects/repository";
import { ensurePublishingIndexes, PublishingRepository } from "../src/modules/publishing/repository";
import { PublishingService } from "../src/modules/publishing/service";
import { createRendererApp } from "../src/renderer/app";
import { SiteResolver } from "../src/renderer/resolver";
import { testEnv, testLogger } from "./helpers";
import { startTestDatabase, type TestDatabase } from "./mongo";

/**
 * One boundary decides what a visitor sees: publishing the site.
 *
 * Everything else is a draft, including a post marked ready and a template saved and promoted. The
 * product said otherwise in two places — a post action called "Publish" and a template action whose
 * success message said the layout was live and every post already used it — while the renderer
 * served the frozen snapshot and neither had touched it.
 *
 * These assert the boundary itself, so the copy has something true to describe.
 */
let database: TestDatabase;
let projects: ProjectRepository;
let blog: BlogRepository;
let templates: TemplateRepository;
let publishing: PublishingRepository;
let service: PublishingService;
let resolver: SiteResolver;

const A: WorkspaceContext = { workspaceId: "workspace-a", userId: "user-a" };
const HOST = "boundary.example.test";

const renderer = () => createRendererApp({ env: testEnv(), logger: testLogger(), resolver });
const publicHtml = () => request(renderer()).get("/blog").set("host", HOST);

beforeAll(async () => {
  database = await startTestDatabase();
  projects = new ProjectRepository(database.db);
  blog = new BlogRepository(database.db);
  templates = new TemplateRepository(database.db);
  publishing = new PublishingRepository(database.db, database.db.collection(COLLECTIONS.projects));
  service = new PublishingService({
    projects,
    publishing,
    blog,
    media: new MediaRepository(database.db, createGridFsStorage(database.db)),
    loadBlogTemplates: async (context, projectId) => ({
      index: (await templates.findPublished(projectId, "index")) ?? undefined,
      article: (await templates.findPublished(projectId, "article")) ?? undefined,
    }),
  });
  resolver = new SiteResolver(publishing, 60);
}, 120_000);

afterAll(async () => {
  await database?.stop();
});

beforeEach(async () => {
  await database.clear();
  await ensurePublishingIndexes(database.db);
  await ensureBlogIndexes(database.db);
  await ensureTemplateIndexes(database.db);
  resolver.invalidateAll();
});

/** A site with a blog turned on, published once, and reachable on its own hostname. */
async function liveBlog() {
  const project = await projects.create(A, { name: "Boundary" });
  await repairBlogTemplates({ repository: blog, templates }, A, project.id, { format: "list" });

  const domain = await publishing.ensurePlatformDomain(A, project.id, HOST.split(".")[0]!, "example.test");
  if (domain === null) throw new Error("no hostname");

  expect((await service.publish(A, project.id)).status).toBe("published");
  resolver.invalidateAll();
  return project.id;
}

const readyPost = async (projectId: string, title: string) => {
  const post = await blog.create(A, projectId, {
    title,
    slug: title.toLowerCase().replace(/\s+/g, "-"),
    excerpt: "",
    content: { type: "doc", content: [] } as never,
    categoryIds: [],
    tags: [],
    customFieldValues: {},
    status: "draft",
  });
  await blog.update(A, projectId, post.id, { ...post, status: "published" } as never);
  return post;
};

describe("marking a post ready", () => {
  it("does not change the public page", async () => {
    const projectId = await liveBlog();
    const before = await publicHtml();

    await readyPost(projectId, "Waiting to go out");

    // The renderer serves the frozen snapshot. A post becoming ready is a decision about the *next*
    // snapshot, and the product used to call that action "Publish".
    const after = await publicHtml();
    expect(after.text).toBe(before.text);
    expect(after.text).not.toContain("Waiting to go out");
  });

  it("appears only after the site is published", async () => {
    const projectId = await liveBlog();
    await readyPost(projectId, "Waiting to go out");

    expect((await service.publish(A, projectId)).status).toBe("published");
    resolver.invalidateAll();

    expect((await publicHtml()).text).toContain("Waiting to go out");
  });
});

describe("saving and promoting a template", () => {
  it("does not change the public page on its own", async () => {
    const projectId = await liveBlog();
    await readyPost(projectId, "An article");
    expect((await service.publish(A, projectId)).status).toBe("published");
    resolver.invalidateAll();

    const before = await publicHtml();

    const template = await templates.loadOrCreate(A, projectId, "index");
    await templates.saveDraft(A, projectId, "index", {
      draftDocument: { ...template.draftDocument, name: "Designed index" },
      fieldDefinitions: [],
    });
    await templates.publish(A, projectId, "index", []);

    // The template store's own "publish" promotes a draft inside that store. What a visitor receives
    // is the template frozen into the site snapshot, and this changed neither.
    expect((await publicHtml()).text).toBe(before.text);
  });
});

describe("a site publish that fails", () => {
  it("leaves the previous version serving", async () => {
    const projectId = await liveBlog();
    await readyPost(projectId, "First out");
    expect((await service.publish(A, projectId)).status).toBe("published");
    resolver.invalidateAll();
    const live = await publicHtml();

    // Break the draft in a way the compiler itself refuses: a block pointing at a form that does
    // not exist. Readiness reports it as blocking, so the publish is stopped before any write.
    const stored = await projects.findById(A, projectId);
    const { id, workspaceId, createdByUserId, revision, createdAt, updatedAt, ...document } = stored!;
    const typed = document as ReturnType<typeof createProjectDocument>;
    typed.pages[0]!.sections[0]!.elements = [
      {
        id: "orphan-form",
        name: "",
        type: "form",
        version: 2,
        formId: "does-not-exist",
        presentation: DEFAULT_FORM_PRESENTATION,
        geometry: { x: 0, y: 0, width: 480, height: 360, rotation: 0 },
        responsiveLayout: {
          width: { value: 480, unit: "px" },
          height: { value: 360, unit: "px" },
          horizontalConstraint: "left",
          verticalConstraint: "top",
          visible: true,
        },
        zIndex: 1,
        locked: false,
        hidden: false,
      } as never,
    ];
    expect(await projects.saveDocument(A, projectId, revision, typed)).not.toBeNull();

    const refused = await service.publish(A, projectId);
    expect(refused.status).toBe("blocked");
    resolver.invalidateAll();

    // A refused publish must not take the site down with it.
    expect((await publicHtml()).text).toBe(live.text);
    expect((await publicHtml()).text).toContain("First out");
  });
});
