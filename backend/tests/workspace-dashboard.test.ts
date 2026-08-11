import { createPage, EMPTY_RICH_TEXT } from "@websitebuilder/shared";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ensureAnalyticsIndexes, SiteViewRepository } from "../src/modules/analytics/repository";
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
  await ensureAnalyticsIndexes(database.db);
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

  it("reports no traffic as measured zero, over a complete window", async () => {
    const dashboard = await loadWorkspaceDashboard(database.db, tenantA, { days: 7 });

    expect(dashboard.traffic.totalViews).toBe(0);
    // Seven days, every one of them present. A chart drawn from a shorter array would show a week
    // of no visits as a shorter week.
    expect(dashboard.traffic.byDay).toHaveLength(7);
    expect(dashboard.traffic.byDay.every((day) => day.views === 0)).toBe(true);
  });

  it("distinguishes a workspace with no forms from one whose forms received nothing", async () => {
    const dashboard = await loadWorkspaceDashboard(database.db, tenantA);
    expect(dashboard.forms).toEqual({ definitions: 0, submissions: 0, unread: 0, state: "no_forms" });
  });
});

describe("traffic", () => {
  const view = (context: WorkspaceContext, projectId: string, path: string, at: Date) =>
    new SiteViewRepository(database.db).record({ workspaceId: context.workspaceId, projectId, path, at });

  it("sums a page's views across a day and across days", async () => {
    const site = await projects.create(tenantA, { name: "Aurora" });
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

    await view(tenantA, site.id, "/", today);
    await view(tenantA, site.id, "/", today);
    await view(tenantA, site.id, "/", yesterday);

    const dashboard = await loadWorkspaceDashboard(database.db, tenantA, { days: 7 });
    expect(dashboard.traffic.totalViews).toBe(3);
    expect(dashboard.traffic.byDay.at(-1)).toEqual({ day: today.toISOString().slice(0, 10), views: 2 });
  });

  it("ranks pages and names the site each one belongs to", async () => {
    const site = await projects.create(tenantA, { name: "Aurora" });
    const now = new Date();

    await view(tenantA, site.id, "/about", now);
    await view(tenantA, site.id, "/", now);
    await view(tenantA, site.id, "/", now);

    const dashboard = await loadWorkspaceDashboard(database.db, tenantA);
    expect(dashboard.traffic.topPages).toEqual([
      { projectId: site.id, siteName: "Aurora", path: "/", views: 2 },
      { projectId: site.id, siteName: "Aurora", path: "/about", views: 1 },
    ]);
  });

  it("covers every site by default and one site when filtered", async () => {
    const first = await projects.create(tenantA, { name: "First" });
    const second = await projects.create(tenantA, { name: "Second" });
    const now = new Date();

    await view(tenantA, first.id, "/", now);
    await view(tenantA, second.id, "/", now);
    await view(tenantA, second.id, "/", now);

    const all = await loadWorkspaceDashboard(database.db, tenantA);
    expect(all.traffic.totalViews).toBe(3);
    expect(all.traffic.bySite.map((row) => row.siteName)).toEqual(["Second", "First"]);

    const filtered = await loadWorkspaceDashboard(database.db, tenantA, { projectId: first.id });
    expect(filtered.traffic.totalViews).toBe(1);
    expect(filtered.traffic.projectId).toBe(first.id);
  });

  it("leaves out days older than the window", async () => {
    const site = await projects.create(tenantA, { name: "Aurora" });
    const longAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

    await view(tenantA, site.id, "/", longAgo);

    expect((await loadWorkspaceDashboard(database.db, tenantA, { days: 7 })).traffic.totalViews).toBe(0);
    expect((await loadWorkspaceDashboard(database.db, tenantA, { days: 90 })).traffic.totalViews).toBe(1);
  });

  it("never counts another workspace's traffic, even for the same page path", async () => {
    const mine = await projects.create(tenantA, { name: "Mine" });
    const theirs = await projects.create(tenantB, { name: "Theirs" });
    const now = new Date();

    await view(tenantA, mine.id, "/", now);
    await view(tenantB, theirs.id, "/", now);
    await view(tenantB, theirs.id, "/", now);

    expect((await loadWorkspaceDashboard(database.db, tenantA)).traffic.totalViews).toBe(1);
    // Asking for a site that belongs to someone else returns that site's absence, not its numbers.
    const probe = await loadWorkspaceDashboard(database.db, tenantA, { projectId: theirs.id });
    expect(probe.traffic.totalViews).toBe(0);
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
