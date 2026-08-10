import { createPage, EMPTY_RICH_TEXT } from "@websitebuilder/shared";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { BlogRepository, ensureBlogIndexes } from "../src/modules/blog/repository";
import { ClientRepository } from "../src/modules/clients/repository";
import { MediaRepository } from "../src/modules/media/repository";
import { createGridFsStorage } from "../src/modules/media/storage";
import { ProjectRepository, type WorkspaceContext } from "../src/modules/projects/repository";
import { loadWorkspaceDashboard } from "../src/modules/workspaces/dashboard";
import { startTestDatabase, type TestDatabase } from "./mongo";

let database: TestDatabase;
let projects: ProjectRepository;
let clients: ClientRepository;
let blog: BlogRepository;
let media: MediaRepository;

const tenantA: WorkspaceContext = { workspaceId: "workspace-a", userId: "user-a" };
const tenantB: WorkspaceContext = { workspaceId: "workspace-b", userId: "user-b" };

const post = (overrides: Record<string, unknown> = {}) => ({
  title: "Post",
  slug: "",
  excerpt: "",
  content: EMPTY_RICH_TEXT,
  categoryIds: [],
  tags: [],
  customFieldValues: {},
  status: "draft" as const,
  ...overrides,
});

beforeAll(async () => {
  database = await startTestDatabase();
  await ensureBlogIndexes(database.db);
  projects = new ProjectRepository(database.db);
  clients = new ClientRepository(database.db);
  blog = new BlogRepository(database.db);
  media = new MediaRepository(database.db, createGridFsStorage(database.db));
}, 120_000);

afterAll(async () => {
  await database.stop();
});

beforeEach(async () => {
  await database.clear();
  await ensureBlogIndexes(database.db);
});

describe("empty workspace", () => {
  it("reports zeros without inventing anything", async () => {
    const dashboard = await loadWorkspaceDashboard(database.db, tenantA);

    expect(dashboard.clients.total).toBe(0);
    expect(dashboard.sites.total).toBe(0);
    expect(dashboard.content.pages).toBe(0);
    expect(dashboard.media).toEqual({ assets: 0, storageBytes: 0 });
    expect(dashboard.recentSites).toEqual([]);
  });

  it("reports analytics as not connected rather than as zero traffic", async () => {
    const dashboard = await loadWorkspaceDashboard(database.db, tenantA);
    expect(dashboard.analytics).toEqual({ state: "not_connected" });
    expect(dashboard.analytics).not.toHaveProperty("visits");
  });
});

describe("counts", () => {
  it("counts clients by status", async () => {
    await clients.create(tenantA, { name: "Active", type: "company", status: "active" });
    await clients.create(tenantA, { name: "Lead", type: "person", status: "lead" });
    await clients.create(tenantA, { name: "Paused", type: "company", status: "paused" });

    const dashboard = await loadWorkspaceDashboard(database.db, tenantA);
    expect(dashboard.clients).toEqual({ total: 3, active: 1, needingAttention: 2 });
  });

  it("separates client-owned sites from direct ones", async () => {
    const client = await clients.create(tenantA, { name: "C", type: "company", status: "active" });
    await projects.create(tenantA, { name: "Client site", clientId: client.id });
    await projects.create(tenantA, { name: "Direct site" });

    const dashboard = await loadWorkspaceDashboard(database.db, tenantA);
    expect(dashboard.sites).toEqual({ total: 2, withClient: 1, direct: 1 });
  });

  it("sums pages across sites without loading a single builder document", async () => {
    const first = await projects.create(tenantA, { name: "A" });
    const document = {
      schemaVersion: first.schemaVersion,
      name: first.name,
      slug: first.slug,
      breakpoints: first.breakpoints,
      pages: [...first.pages, createPage({ name: "About", slug: "about", order: 1 })],
      sharedSections: first.sharedSections,
      seo: first.seo,
      featureStates: first.featureStates,
    };
    await projects.saveDocument(tenantA, first.id, first.revision, document);
    await projects.create(tenantA, { name: "B" });

    const dashboard = await loadWorkspaceDashboard(database.db, tenantA);
    expect(dashboard.content.pages).toBe(3);
  });

  it("counts published and draft posts separately", async () => {
    await blog.create(tenantA, "p1", post({ title: "Live", status: "published" }));
    await blog.create(tenantA, "p1", post({ title: "Draft" }));

    const dashboard = await loadWorkspaceDashboard(database.db, tenantA);
    expect(dashboard.content).toMatchObject({ publishedPosts: 1, draftPosts: 1 });
  });

  it("sums media storage across every variant", async () => {
    const bytes = await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .png()
      .toBuffer();
    const asset = await media.upload(tenantA, { data: bytes, filename: "a.png" });

    const dashboard = await loadWorkspaceDashboard(database.db, tenantA);
    expect(dashboard.media.assets).toBe(1);
    expect(dashboard.media.storageBytes).toBe(asset.variants.reduce((total, v) => total + v.bytes, 0));
  }, 30_000);
});

describe("tenant isolation", () => {
  it("counts nothing from another workspace", async () => {
    await clients.create(tenantB, { name: "Theirs", type: "company", status: "active" });
    await projects.create(tenantB, { name: "Their site" });
    await blog.create(tenantB, "p1", post({ status: "published" }));

    const dashboard = await loadWorkspaceDashboard(database.db, tenantA);
    expect(dashboard.clients.total).toBe(0);
    expect(dashboard.sites.total).toBe(0);
    expect(dashboard.content.publishedPosts).toBe(0);
  });

  it("switching workspace changes every number", async () => {
    await projects.create(tenantA, { name: "A site" });
    await projects.create(tenantB, { name: "B site" });
    await projects.create(tenantB, { name: "B site two" });

    expect((await loadWorkspaceDashboard(database.db, tenantA)).sites.total).toBe(1);
    expect((await loadWorkspaceDashboard(database.db, tenantB)).sites.total).toBe(2);
  });

  it("lists only this workspace's recent sites and clients", async () => {
    await projects.create(tenantA, { name: "Mine" });
    await projects.create(tenantB, { name: "Theirs" });

    const dashboard = await loadWorkspaceDashboard(database.db, tenantA);
    expect(dashboard.recentSites.map((site) => site.name)).toEqual(["Mine"]);
  });
});
