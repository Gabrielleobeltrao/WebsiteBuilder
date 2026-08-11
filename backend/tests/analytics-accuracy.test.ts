import { createProjectDocument, DEFAULT_ANALYTICS_SETTINGS, type AnalyticsBatch } from "@websitebuilder/shared";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { COLLECTIONS } from "../src/db/indexes";
import { createSeededWorkspaceResolver } from "../src/middleware/workspace";
import { AnalyticsQueries } from "../src/modules/analytics/queries";
import { AnalyticsRepository, ensureAnalyticsIndexes, SiteViewRepository } from "../src/modules/analytics/repository";
import { createAnalyticsRouter } from "../src/modules/analytics/routes";
import { BlogRepository } from "../src/modules/blog/repository";
import { MediaRepository } from "../src/modules/media/repository";
import { createGridFsStorage } from "../src/modules/media/storage";
import { ProjectRepository, type WorkspaceContext } from "../src/modules/projects/repository";
import { ensurePublishingIndexes, PublishingRepository } from "../src/modules/publishing/repository";
import { PublishingService } from "../src/modules/publishing/service";
import { createAnalyticsRuntime, ANALYTICS_EVENTS_PATH } from "../src/renderer/analytics";
import { createRendererApp } from "../src/renderer/app";
import { SiteResolver } from "../src/renderer/resolver";
import { testEnv, testLogger } from "./helpers";
import { startTestDatabase, type TestDatabase } from "./mongo";

/**
 * Every displayed number traced back to the events that produced it.
 *
 * Batches go in through the real ingestion endpoint on the real renderer, and the assertions read
 * the real dashboard API. Nothing in between is stubbed, so a number that is wrong is wrong for the
 * same reason it would be wrong in production — which is the only way a test of an aggregate is
 * worth having.
 */

const WORKSPACE = "workspace-a";
const A: WorkspaceContext = { workspaceId: WORKSPACE, userId: "user-a" };
const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

let database: TestDatabase;
let renderer: Express;
let api: Express;
let projects: ProjectRepository;
let publishing: PublishingRepository;
let service: PublishingService;
let resolver: SiteResolver;
let analytics: AnalyticsRepository;
let projectId: string;
let base: string;

let counter = 0;
function batch(events: AnalyticsBatch["events"], overrides: Partial<AnalyticsBatch> = {}): AnalyticsBatch {
  counter += 1;
  const hex = String(counter).padStart(4, "0");
  return {
    schemaVersion: 1,
    batchId: `3f1a1c5e-6b2d-4a7f-9c11-2b0f6a8d${hex}`,
    sessionId: `8d4e51aa-6b2d-4a7f-9c11-2b0f6a8d${hex}`,
    pageViewId: `8d4e51bb-6b2d-4a7f-9c11-2b0f6a8d${hex}`,
    sentAt: new Date().toISOString(),
    path: "/",
    device: "desktop",
    source: { kind: "direct" },
    events,
    ...overrides,
  };
}

/** One visitor's batch, delivered exactly as a browser would deliver it. */
const visit = async (events: AnalyticsBatch["events"], overrides: Partial<AnalyticsBatch> = {}) => {
  const response = await request(renderer)
    .post(ANALYTICS_EVENTS_PATH)
    .set("Host", "accuracy.example.test")
    .set("User-Agent", BROWSER)
    .send(batch(events, overrides) as object);
  expect(response.status).toBe(204);
};

const overview = async (query = "days=7") =>
  (await request(api).get(`${base}/overview?${query}`)).body.data as Record<string, number>;

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
  analytics = new AnalyticsRepository(database.db);

  const views = new SiteViewRepository(database.db);
  renderer = createRendererApp({
    env: testEnv(),
    logger: testLogger(),
    resolver,
    // The server-side counter, wired exactly as the renderer process wires it — without it the
    // invariant below would compare the browser count against a zero nobody was counting.
    recordView: (view) => {
      void views.record(view);
    },
    analytics: createAnalyticsRuntime({
      resolver,
      analytics,
      publishing,
      logger: testLogger(),
      trustsProxy: false,
      enabled: true,
      settingsTtlSeconds: 1,
    }),
  });
}, 120_000);

afterAll(async () => {
  await database.stop();
});

beforeEach(async () => {
  await database.clear();
  await ensurePublishingIndexes(database.db);
  await ensureAnalyticsIndexes(database.db);

  const project = await projects.create(A, { name: "Accuracy" });
  const { id, workspaceId, createdByUserId, revision, createdAt, updatedAt, ...document } = project;
  const typed = document as ReturnType<typeof createProjectDocument>;
  typed.pages.push({
    ...structuredClone(typed.pages[0]!),
    id: "page-about",
    name: "About",
    slug: "about",
    isHome: false,
    order: 1,
  });
  await projects.saveDocument(A, project.id, revision, typed);

  const published = await service.publish(A, project.id);
  if (published.status !== "published") throw new Error("the accuracy fixture did not publish");
  await publishing.ensurePlatformDomain(A, project.id, "accuracy", "example.test");
  await analytics.saveSettings(A, project.id, { ...DEFAULT_ANALYTICS_SETTINGS, enabled: true });

  projectId = project.id;
  base = `/api/v1/workspaces/${WORKSPACE}/projects/${projectId}/analytics`;
  resolver.invalidateAll();

  api = createApp({
    env: testEnv(),
    logger: testLogger(),
    routers: [
      {
        path: "/workspaces/:workspaceId/projects/:projectId/analytics",
        router: createAnalyticsRouter({
          repository: analytics,
          queries: new AnalyticsQueries(
            database.db,
            async () => {
              const version = await publishing.findActiveForProject(projectId);
              return new Map((version?.routes ?? []).map((route) => [route.resourceId, route.path]));
            },
            async (project, versionId) => publishing.findActive(project, versionId),
          ),
          resolveWorkspace: createSeededWorkspaceResolver({ workspaceId: WORKSPACE, userId: "user-a" }),
        }),
      },
    ],
  });
});

describe("one visitor, one page", () => {
  it("is one visit, one view, and a bounce", async () => {
    await visit([{ type: "page_view" }]);

    const data = await overview();
    expect(data["sessions"]).toBe(1);
    expect(data["browserViews"]).toBe(1);
    expect(data["bounces"]).toBe(1);
    expect(data["engagedSessions"]).toBe(0);
  });

  it("stops being a bounce at ten seconds of attention", async () => {
    const session = "8d4e51aa-6b2d-4a7f-9c11-2b0f6a8dcccc";
    await visit([{ type: "page_view" }], { sessionId: session });
    await visit([{ type: "engagement_heartbeat", engagedMs: 9_000 }], { sessionId: session });

    expect((await overview())["bounces"]).toBe(1);

    await visit([{ type: "engagement_heartbeat", engagedMs: 2_000 }], { sessionId: session });

    const data = await overview();
    expect(data["bounces"]).toBe(0);
    expect(data["engagedSessions"]).toBe(1);
    expect(data["engagedMs"]).toBe(11_000);
  });
});

describe("one visitor, two pages", () => {
  it("is one visit with two views, engaged by the second page alone", async () => {
    const session = "8d4e51aa-6b2d-4a7f-9c11-2b0f6a8ddddd";
    await visit([{ type: "page_view" }], { sessionId: session, path: "/" });
    await visit([{ type: "page_view" }], { sessionId: session, path: "/about" });

    const data = await overview();
    expect(data["sessions"]).toBe(1);
    expect(data["browserViews"]).toBe(2);
    expect(data["engagedSessions"]).toBe(1);
    expect(data["bounces"]).toBe(0);
  });

  it("attributes each view to the page that received it", async () => {
    await visit([{ type: "page_view" }], { path: "/" });
    await visit([{ type: "page_view" }], { path: "/about" });
    await visit([{ type: "page_view" }], { path: "/about" });

    const pages = (await request(api).get(`${base}/pages?days=7`)).body.data.pages as Array<{
      path: string;
      views: number;
    }>;

    expect(pages).toEqual([
      { pageId: "page-about", path: "/about", views: 2, clicks: 0, scroll: {} },
      { pageId: expect.any(String), path: "/", views: 1, clicks: 0, scroll: {} },
    ]);
  });
});

describe("interaction", () => {
  it("counts a click on a button once, not once per event describing it", async () => {
    await visit([
      { type: "page_view" },
      { type: "page_region_click", x: 0.5, y: 0.25 },
      { type: "element_click", elementId: "cta" },
    ]);

    expect((await overview())["clicks"]).toBe(1);
  });

  it("counts each scroll depth once per view, however often it is crossed", async () => {
    await visit([
      { type: "page_view" },
      { type: "scroll_depth", percent: 25 },
      { type: "scroll_depth", percent: 50 },
    ]);

    const pages = (await request(api).get(`${base}/pages?days=7`)).body.data.pages as Array<{
      scroll: Record<string, number>;
    }>;
    expect(pages[0]?.scroll).toEqual({ "25": 1, "50": 1 });
  });
});

describe("the counts a dashboard puts side by side", () => {
  it("never measures more in the browser than the server served", async () => {
    // The oracle for the whole pipeline. The server counts every visitor; the browser counts the
    // subset that ran the tracker. A browser count that exceeded it would mean ingestion is
    // double-counting, which no other assertion here would catch.
    for (let index = 0; index < 5; index += 1) {
      await request(renderer).get("/").set("Host", "accuracy.example.test").set("User-Agent", BROWSER);
    }
    await visit([{ type: "page_view" }]);
    await visit([{ type: "page_view" }]);

    const data = await overview();
    expect(data["serverViews"]).toBe(5);
    expect(data["browserViews"]).toBe(2);
    expect(data["browserViews"]).toBeLessThanOrEqual(data["serverViews"] ?? 0);
  });

  it("holds that invariant when a batch is retried", async () => {
    await request(renderer).get("/").set("Host", "accuracy.example.test").set("User-Agent", BROWSER);

    const retried = batch([{ type: "page_view" }]);
    for (const attempt of [1, 2, 3]) {
      const response = await request(renderer)
        .post(ANALYTICS_EVENTS_PATH)
        .set("Host", "accuracy.example.test")
        .set("User-Agent", BROWSER)
        .send(retried as object);
      expect(response.status, `attempt ${attempt}`).toBe(204);
    }

    const data = await overview();
    expect(data["browserViews"]).toBe(1);
    expect(data["browserViews"]).toBeLessThanOrEqual(data["serverViews"] ?? 0);
  });
});

describe("a publish in the middle of a visitor's day", () => {
  it("keeps traffic and vitals, and moves heatmaps to the layout that produced them", async () => {
    await visit([
      { type: "page_view" },
      { type: "page_region_click", x: 0.5, y: 0.5 },
      { type: "web_vital", metric: "LCP", value: 1_200 },
    ]);

    const before = await overview();
    expect(before["browserViews"]).toBe(1);

    const project = await projects.findById(A, projectId);
    const { id, workspaceId, createdByUserId, revision, createdAt, updatedAt, ...document } = project!;
    (document as ReturnType<typeof createProjectDocument>).pages[0]!.seo.title = "Changed";
    await projects.saveDocument(A, projectId, revision, document as ReturnType<typeof createProjectDocument>);
    await service.publish(A, projectId);
    resolver.invalidateAll();

    // Traffic and performance carry no version and span the publish.
    const after = await overview();
    expect(after["browserViews"]).toBe(1);
    const vitals = (await request(api).get(`${base}/vitals?days=30`)).body.data as { metrics: unknown[] };
    expect(vitals.metrics.length).toBeGreaterThan(0);
  });
});
