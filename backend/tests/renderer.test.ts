import { createProjectDocument } from "@websitebuilder/shared";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { COLLECTIONS } from "../src/db/indexes";
import { BlogRepository } from "../src/modules/blog/repository";
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
 * Two tenants share one renderer process for every test in this file. Anything that leaks between
 * them here would leak between real customers in production.
 */
let database: TestDatabase;
let projects: ProjectRepository;
let publishing: PublishingRepository;
let service: PublishingService;
let resolver: SiteResolver;

const A: WorkspaceContext = { workspaceId: "workspace-a", userId: "user-a" };
const B: WorkspaceContext = { workspaceId: "workspace-b", userId: "user-b" };

const renderer = (overrides: Partial<ReturnType<typeof testEnv>> = {}) =>
  createRendererApp({ env: { ...testEnv(), ...overrides }, logger: testLogger(), resolver });

/** Creates a project, names its home page, publishes it and gives it a live hostname. */
async function liveSite(context: WorkspaceContext, name: string, hostname: string) {
  const project = await projects.create(context, { name });

  const { id, workspaceId, createdByUserId, revision, createdAt, updatedAt, ...document } = project;
  const typed = document as ReturnType<typeof createProjectDocument>;
  typed.pages[0]!.seo.title = `${name} home`;
  typed.pages[0]!.seo.description = `${name} description`;
  typed.seo.siteName = name;
  typed.pages.push({
    ...structuredClone(typed.pages[0]!),
    id: `${name}-about`,
    name: "About",
    slug: "about",
    isHome: false,
    order: 1,
    seo: { ...typed.pages[0]!.seo, title: `${name} about` },
  });
  const saved = await projects.saveDocument(context, project.id, revision, typed);
  // Setup that fails quietly produces a test failure with no explanation. Both of these return
  // rather than throw on failure, so they are checked here.
  if (saved === null) throw new Error(`saveDocument rejected the ${name} fixture`);

  const published = await service.publish(context, project.id);
  if (published.status !== "published") {
    throw new Error(`publishing ${name} returned ${published.status}: ${JSON.stringify(published)}`);
  }

  const domain = await publishing.ensurePlatformDomain(context, project.id, hostname.split(".")[0]!, "example.test");
  if (domain === null) throw new Error(`no platform hostname for ${name}`);

  resolver.invalidateAll();
  return project.id;
}

beforeAll(async () => {
  database = await startTestDatabase();
  projects = new ProjectRepository(database.db);
  publishing = new PublishingRepository(database.db, database.db.collection(COLLECTIONS.projects));
  service = new PublishingService({
    projects,
    publishing,
    blog: new BlogRepository(database.db),
    media: new MediaRepository(database.db, createGridFsStorage(database.db)),
  });
  resolver = new SiteResolver(publishing, 60);
}, 120_000);

afterAll(async () => {
  await database.stop();
});

beforeEach(async () => {
  await database.clear();
  await ensurePublishingIndexes(database.db);
  resolver.invalidateAll();
});

describe("health", () => {
  it("answers without requiring a site hostname", async () => {
    const response = await request(renderer()).get("/healthz");
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("ok");
  });
});

describe("host resolution", () => {
  it("serves each tenant its own site from one process", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    await liveSite(B, "Beta", "beta.example.test");

    const app = renderer();
    const alpha = await request(app).get("/").set("Host", "alpha.example.test");
    const beta = await request(app).get("/").set("Host", "beta.example.test");

    expect(alpha.text).toContain("Alpha home");
    expect(alpha.text).not.toContain("Beta");
    expect(beta.text).toContain("Beta home");
    expect(beta.text).not.toContain("Alpha");
  });

  it("gives an unknown host the same neutral answer as a host that exists but is not live", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");

    const app = renderer();
    const unknown = await request(app).get("/").set("Host", "nothing.example.test");
    const pending = await request(app).get("/").set("Host", "alpha.example.test.evil.test");

    expect(unknown.status).toBe(404);
    expect(pending.status).toBe(404);
    expect(unknown.text).toBe(pending.text);
  });

  it("does not let a query parameter or header choose the project", async () => {
    const alphaId = await liveSite(A, "Alpha", "alpha.example.test");
    await liveSite(B, "Beta", "beta.example.test");

    const response = await request(renderer())
      .get(`/?projectId=${alphaId}`)
      .set("Host", "beta.example.test")
      .set("x-project-id", alphaId);

    // Identity comes from the hostname alone.
    expect(response.text).toContain("Beta home");
    expect(response.text).not.toContain("Alpha");
  });

  it("ignores a forwarded host when no proxy range is trusted", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    await liveSite(B, "Beta", "beta.example.test");

    const response = await request(renderer())
      .get("/")
      .set("Host", "beta.example.test")
      .set("X-Forwarded-Host", "alpha.example.test");

    expect(response.text).toContain("Beta home");
  });
});

describe("routes", () => {
  it("serves each route its own content and metadata", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");

    const app = renderer();
    const home = await request(app).get("/").set("Host", "alpha.example.test");
    const about = await request(app).get("/about").set("Host", "alpha.example.test");

    expect(home.text).toContain("<title>Alpha home | Alpha</title>");
    expect(about.text).toContain("<title>Alpha about | Alpha</title>");
    expect(about.text).toContain('<link rel="canonical" href="https://alpha.example.test/about">');
  });

  it("delivers metadata before any client JavaScript", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    const response = await request(renderer()).get("/").set("Host", "alpha.example.test");

    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.text).toContain('<meta name="description" content="Alpha description">');
    expect(response.text).toContain('<meta property="og:title"');
    expect(response.text).not.toContain("<script");
  });

  it("treats a trailing slash as the same page rather than a second URL", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");

    const app = renderer();
    const plain = await request(app).get("/about").set("Host", "alpha.example.test");
    const slashed = await request(app).get("/about/").set("Host", "alpha.example.test");

    expect(slashed.status).toBe(200);
    expect(slashed.text).toBe(plain.text);
  });

  it("answers an unknown path with the site's own 404 and a noindex directive", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    const response = await request(renderer()).get("/nowhere").set("Host", "alpha.example.test");

    expect(response.status).toBe(404);
    expect(response.text).toContain("noindex");
  });
});

describe("caching", () => {
  it("serves a published change after the site's cache entry is invalidated", async () => {
    const projectId = await liveSite(A, "Alpha", "alpha.example.test");

    const app = renderer();
    expect((await request(app).get("/").set("Host", "alpha.example.test")).text).toContain("Alpha home");

    const project = await projects.findById(A, projectId);
    const { id, workspaceId, createdByUserId, revision, createdAt, updatedAt, ...document } = project!;
    const typed = document as ReturnType<typeof createProjectDocument>;
    typed.pages[0]!.seo.title = "Renamed";
    await projects.saveDocument(A, projectId, revision, typed);
    await service.publish(A, projectId);

    // Still the old page: the cache is doing its job.
    expect((await request(app).get("/").set("Host", "alpha.example.test")).text).toContain("Alpha home");

    resolver.invalidateHost("alpha.example.test");
    expect((await request(app).get("/").set("Host", "alpha.example.test")).text).toContain("Renamed");
  });

  it("never returns one tenant's cached page for another host", async () => {
    await liveSite(A, "Alpha", "alpha.example.test");
    await liveSite(B, "Beta", "beta.example.test");

    const app = renderer();
    await request(app).get("/").set("Host", "alpha.example.test");
    const beta = await request(app).get("/").set("Host", "beta.example.test");

    expect(beta.text).toContain("Beta home");
  });
});
