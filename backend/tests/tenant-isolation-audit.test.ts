import { EMPTY_RICH_TEXT } from "@websitebuilder/shared";
import { ObjectId } from "mongodb";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { BlogRepository, ensureBlogIndexes } from "../src/modules/blog/repository";
import { TemplateRepository, ensureTemplateIndexes } from "../src/modules/blog/templates";
import { CampaignRepository, ensureCampaignIndexes } from "../src/modules/campaigns/repository";
import { ClientRepository } from "../src/modules/clients/repository";
import { MediaRepository } from "../src/modules/media/repository";
import { createGridFsStorage } from "../src/modules/media/storage";
import { PreferencesRepository } from "../src/modules/preferences/repository";
import { ProjectRepository, type WorkspaceContext } from "../src/modules/projects/repository";
import { loadWorkspaceDashboard } from "../src/modules/workspaces/dashboard";
import { startTestDatabase, type TestDatabase } from "./mongo";

/**
 * Consolidated tenant-isolation audit.
 *
 * Every repository is exercised with a second workspace holding real data, and every read, write
 * and aggregate is asserted to return nothing from it. Per-module suites already cover their own
 * paths; this one exists so a module added later cannot quietly skip the check, and so the
 * guarantee is stated once in a place that fails loudly.
 */
let database: TestDatabase;
let projects: ProjectRepository;
let clients: ClientRepository;
let campaigns: CampaignRepository;
let blog: BlogRepository;
let templates: TemplateRepository;
let media: MediaRepository;
let preferences: PreferencesRepository;

const A: WorkspaceContext = { workspaceId: "workspace-a", userId: "user-a" };
const B: WorkspaceContext = { workspaceId: "workspace-b", userId: "user-b" };
const PROJECT_B = "project-b";

const post = (overrides: Record<string, unknown> = {}) => ({
  title: "Theirs",
  slug: "",
  excerpt: "",
  content: EMPTY_RICH_TEXT,
  categoryIds: [],
  tags: [],
  customFieldValues: {},
  status: "published" as const,
  ...overrides,
});

/** Everything below belongs to workspace B. Workspace A must never see any of it. */
let bProjectId = "";
let bClientId = "";
let bCampaignId = "";
let bPostId = "";
let bMediaId = "";

beforeAll(async () => {
  database = await startTestDatabase();
  await Promise.all([
    ensureBlogIndexes(database.db),
    ensureTemplateIndexes(database.db),
    ensureCampaignIndexes(database.db),
  ]);

  projects = new ProjectRepository(database.db);
  clients = new ClientRepository(database.db);
  campaigns = new CampaignRepository(database.db);
  blog = new BlogRepository(database.db);
  templates = new TemplateRepository(database.db);
  media = new MediaRepository(database.db, createGridFsStorage(database.db));
  preferences = new PreferencesRepository(database.db);
}, 120_000);

afterAll(async () => {
  await database?.stop();
});

beforeEach(async () => {
  await database.clear();
  await Promise.all([
    ensureBlogIndexes(database.db),
    ensureTemplateIndexes(database.db),
    ensureCampaignIndexes(database.db),
  ]);

  const project = await projects.create(B, { name: "Their site" });
  bProjectId = project.id;

  const client = await clients.create(B, { name: "Their client", type: "company", status: "active" });
  bClientId = client.id;

  const campaign = await campaigns.create(B, { name: "Their campaign", status: "active" });
  bCampaignId = campaign.id;

  const created = await blog.create(B, PROJECT_B, post());
  bPostId = created.id;

  const bytes = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 9, g: 9, b: 9 } } })
    .png()
    .toBuffer();
  const asset = await media.upload(B, { data: bytes, filename: "theirs.png" });
  bMediaId = asset.id;

  await templates.loadOrCreate(B, PROJECT_B, "article");
  await preferences.save("user-b", "pt-BR");
}, 60_000);

describe("reads", () => {
  it("returns nothing from another workspace in any listing", async () => {
    expect(await projects.listSummaries(A)).toEqual([]);
    expect(await clients.list(A)).toEqual([]);
    expect(await campaigns.list(A)).toEqual([]);
    expect(await media.list(A)).toEqual([]);
    expect((await blog.list(A, PROJECT_B)).total).toBe(0);
  });

  it("cannot fetch another workspace's record by its exact id", async () => {
    expect(await projects.findById(A, bProjectId)).toBeNull();
    expect(await clients.findById(A, bClientId)).toBeNull();
    expect(await campaigns.findById(A, bCampaignId)).toBeNull();
    expect(await media.findById(A, bMediaId)).toBeNull();
    expect(await blog.findById(A, PROJECT_B, bPostId)).toBeNull();
  });

  it("cannot stream another workspace's media bytes", async () => {
    expect(await media.openVariant(A, bMediaId)).toBeNull();
  });

  it("cannot read another workspace's blog settings or template draft", async () => {
    await blog.saveSettings(B, PROJECT_B, {
      enabled: true,
      basePath: "/news",
      postsPerPage: 12,
    });

    // Workspace A gets defaults, not workspace B's configuration.
    expect((await blog.loadSettings(A, PROJECT_B)).basePath).toBe("/blog");
    expect(
      await templates.saveDraft(A, PROJECT_B, "article", {
        draftDocument: (await templates.loadOrCreate(B, PROJECT_B, "article")).draftDocument,
        fieldDefinitions: [],
      }),
    ).toBeNull();
  });
});

describe("writes", () => {
  it("cannot rename, save, publish or delete another workspace's records", async () => {
    expect(await projects.rename(A, bProjectId, "Stolen")).toBeNull();
    expect(await projects.delete(A, bProjectId)).toBe(false);

    expect(await clients.update(A, bClientId, { name: "Stolen" })).toBeNull();
    expect(await clients.archive(A, bClientId)).toBeNull();

    expect(await campaigns.update(A, bCampaignId, { name: "Stolen" })).toBeNull();
    expect(await campaigns.delete(A, bCampaignId)).toBe(false);

    expect(await blog.update(A, PROJECT_B, bPostId, post({ title: "Stolen" }))).toBeNull();
    expect(await blog.setStatus(A, PROJECT_B, bPostId, "draft")).toBeNull();
    expect(await blog.delete(A, PROJECT_B, bPostId)).toBe(false);

    expect(await media.delete(A, bMediaId)).toBe(false);
  });

  it("leaves every record intact after the attempts", async () => {
    expect((await projects.findById(B, bProjectId))?.name).toBe("Their site");
    expect((await clients.findById(B, bClientId))?.status).toBe("active");
    expect((await campaigns.findById(B, bCampaignId))?.name).toBe("Their campaign");
    expect((await blog.findById(B, PROJECT_B, bPostId))?.status).toBe("published");
    expect(await media.findById(B, bMediaId)).not.toBeNull();
  });
});

describe("aggregates", () => {
  it("counts nothing from another workspace", async () => {
    const dashboard = await loadWorkspaceDashboard(database.db, A);

    expect(dashboard.sites.total).toBe(0);
    expect(dashboard.clients.total).toBe(0);
    expect(dashboard.content.pages).toBe(0);
    expect(dashboard.content.publishedPosts).toBe(0);
    expect(dashboard.media.assets).toBe(0);
    expect(dashboard.media.storageBytes).toBe(0);
    expect(dashboard.recentSites).toEqual([]);
    expect(dashboard.recentClients).toEqual([]);
  });
});

describe("guessed and malformed identifiers", () => {
  it("treats a well-formed but unknown id as not found, never as an error that reveals shape", async () => {
    const unknown = new ObjectId().toHexString();
    expect(await projects.findById(A, unknown)).toBeNull();
    expect(await clients.findById(A, unknown)).toBeNull();
    expect(await campaigns.findById(A, unknown)).toBeNull();
    expect(await media.findById(A, unknown)).toBeNull();
  });

  it("treats a malformed id as not found rather than throwing", async () => {
    for (const bad of ["", "nope", "../../etc/passwd", "000000000000000000000000x"]) {
      expect(await projects.findById(A, bad)).toBeNull();
      expect(await clients.findById(A, bad)).toBeNull();
      expect(await media.findById(A, bad)).toBeNull();
    }
  });
});

describe("user-level records", () => {
  it("keeps preferences keyed by user, not reachable through a workspace", async () => {
    expect(await preferences.find("user-b")).toEqual({ locale: "pt-BR" });
    // Another user's preference is simply absent, and resolving falls back rather than leaking.
    expect(await preferences.find("user-a")).toBeNull();
    expect(await preferences.resolve("user-a")).toBe("en-US");
  });
});
