import { createPage, createProjectDocument } from "@websitebuilder/shared";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { COLLECTIONS } from "../src/db/indexes";
import { createSeededWorkspaceResolver } from "../src/middleware/workspace";
import { BlogRepository, ensureBlogIndexes } from "../src/modules/blog/repository";
import { MediaRepository } from "../src/modules/media/repository";
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
 * The authenticated draft preview.
 *
 * It is the one route that serves unpublished content as a public-shaped document, so what it
 * checks is mostly what it refuses: another tenant's project, an unauthenticated caller, a write of
 * any kind, and a policy loose enough to run script.
 */

const WORKSPACE = "workspace-a";
const OTHER = "workspace-b";
const A: WorkspaceContext = { workspaceId: WORKSPACE, userId: "user-a" };
const B: WorkspaceContext = { workspaceId: OTHER, userId: "user-b" };

let database: TestDatabase;
let projects: ProjectRepository;
let app: Express;

const previewPath = (workspaceId: string, projectId: string) =>
  `/api/v1/workspaces/${workspaceId}/projects/${projectId}/publishing/preview`;

beforeAll(async () => {
  database = await startTestDatabase();
  projects = new ProjectRepository(database.db);
  const publishing = new PublishingRepository(database.db, database.db.collection(COLLECTIONS.projects));
  const blog = new BlogRepository(database.db);
  const domains = new DomainService(database.db, new UnconfiguredHostnameProvider(), "example.test");

  app = createApp({
    env: testEnv(),
    logger: testLogger(),
    routers: [
      {
        path: "/workspaces/:workspaceId/projects/:projectId/publishing",
        router: createPublishingRouter({
          service: new PublishingService({
            projects,
            publishing,
            blog,
            media: new MediaRepository(database.db, createGridFsStorage(database.db)),
          }),
          repository: publishing,
          domains,
          // Seeded to workspace A: a request naming workspace B is answered from A's context, which
          // is exactly the confusion a tenant-isolation test needs to prove cannot leak.
          resolveWorkspace: createSeededWorkspaceResolver({ workspaceId: WORKSPACE, userId: "user-a" }),
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
  await ensurePublishingIndexes(database.db);
});

/** A project whose home page carries a heading, plus a second page to link to. */
async function seedProject(context: WorkspaceContext = A) {
  const project = await projects.create(context, { name: "Acme" });
  const loaded = await projects.findById(context, project.id);
  const { id, workspaceId, createdByUserId, revision, createdAt, updatedAt, ...document } = loaded!;

  const about = createPage({ name: "About", slug: "about", order: 1 });
  const next = { ...document, pages: [...document.pages, about] } as ReturnType<typeof createProjectDocument>;
  const saved = await projects.saveDocument(context, project.id, revision, next);

  return { projectId: project.id, revision: saved!.revision };
}

describe("GET publishing/preview", () => {
  it("returns the draft as a full document", async () => {
    const { projectId } = await seedProject();
    const response = await request(app).get(previewPath(WORKSPACE, projectId));

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.text).toContain("<!doctype html>");
    expect(response.text).toContain("data-page-id");
  });

  it("serves unpublished edits, because that is what a draft is", async () => {
    const { projectId, revision } = await seedProject();
    const loaded = await projects.findById(A, projectId);
    const { id, workspaceId, createdByUserId, revision: _r, createdAt, updatedAt, ...document } = loaded!;
    document.pages[0]!.name = "Renamed before publishing";
    await projects.saveDocument(A, projectId, revision, document as ReturnType<typeof createProjectDocument>);

    // Nothing was ever published, so a preview reading the published snapshot would 404 here.
    const response = await request(app).get(previewPath(WORKSPACE, projectId));
    expect(response.status).toBe(200);
    expect(response.text).toContain("Renamed before publishing");
  });

  it("keeps internal links inside the preview", async () => {
    const { projectId } = await seedProject();
    const loaded = await projects.findById(A, projectId);
    const { id, workspaceId, createdByUserId, revision, createdAt, updatedAt, ...document } = loaded!;

    const home = document.pages[0]!;
    const about = document.pages[1]!;
    home.sections[0]!.elements.push({
      id: "cta",
      type: "button",
      name: "Go",
      text: "About us",
      link: { kind: "internal", pageId: about.id },
      geometry: { x: 0, y: 0, width: 180, height: 48, rotation: 0 },
      responsiveLayout: {
        width: { value: 180, unit: "px" },
        height: { value: 48, unit: "px" },
        horizontalConstraint: "left",
        verticalConstraint: "top",
        visible: true,
      },
      style: {
        fontSize: { value: 16, unit: "px" },
        fontWeight: 600,
        textColor: "#ffffff",
        backgroundColor: "#12806f",
        borderRadius: 6,
        horizontalAlign: "center",
      },
      zIndex: 1,
      locked: false,
      hidden: false,
    } as never);
    await projects.saveDocument(A, projectId, revision, document as ReturnType<typeof createProjectDocument>);

    const response = await request(app).get(previewPath(WORKSPACE, projectId));

    // A bare "/about" would navigate the frame out of the preview and into the application.
    expect(response.text).toContain(`${previewPath(WORKSPACE, projectId)}?path=%2Fabout`);
    expect(response.text).not.toContain('href="/about"');
  });

  it("serves the page a path names, and answers 404 for one the site does not have", async () => {
    const { projectId } = await seedProject();

    expect((await request(app).get(previewPath(WORKSPACE, projectId)).query({ path: "/about" })).status).toBe(200);

    const missing = await request(app).get(previewPath(WORKSPACE, projectId)).query({ path: "/nowhere" });
    expect(missing.status).toBe(404);
    expect(missing.text).not.toContain("data-page-id");
  });

  it("ignores a path that tries to name another origin", async () => {
    const { projectId } = await seedProject();

    // Falls back to the home route rather than resolving anything against "//evil.test".
    const response = await request(app).get(previewPath(WORKSPACE, projectId)).query({ path: "//evil.test/" });
    expect(response.status).toBe(200);
  });

  it("admits one script from its own origin and nothing else", async () => {
    const { projectId } = await seedProject();
    const response = await request(app).get(previewPath(WORKSPACE, projectId));
    const csp = response.headers["content-security-policy"] ?? "";

    // The interaction runtime, served from this origin, so a preview rehearses the behaviour a
    // visitor gets rather than a static approximation. No inline allowance, no third party.
    expect(csp).toContain("script-src 'self'");
    // `unsafe-inline` is granted to styles and nothing else: the responsive stylesheet is inlined
    // into the document, and that is the whole reason the allowance exists.
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain("unsafe-inline'; script");
    expect(response.headers["x-robots-tag"]).toContain("noindex");
    expect(response.headers["cache-control"]).toContain("no-store");
  });

  it("refuses a project belonging to another workspace", async () => {
    const other = await seedProject(B);

    // The workspace in the path is not what scopes the query: the resolved context is, and it
    // belongs to A. Asking for B's project by id must find nothing rather than serve it.
    const response = await request(app).get(previewPath(WORKSPACE, other.projectId));
    expect(response.status).toBe(404);
    expect(response.text).not.toContain("data-page-id");
  });

  it("changes nothing it reads", async () => {
    const { projectId } = await seedProject();
    const before = await projects.findById(A, projectId);

    await request(app).get(previewPath(WORKSPACE, projectId));
    await request(app).get(previewPath(WORKSPACE, projectId)).query({ path: "/about" });

    const after = await projects.findById(A, projectId);
    expect(after).toEqual(before);
    // No publish happened either: preview is not a quiet path to production.
    expect(await database.db.collection(PUBLISHING_COLLECTIONS.versions).countDocuments()).toBe(0);
  });
});
