import type { Express } from "express";
import { ObjectId } from "mongodb";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { COLLECTIONS } from "../src/db/indexes";
import { createSeededWorkspaceResolver } from "../src/middleware/workspace";
import { ANALYTICS_COLLECTIONS, utcDay } from "../src/modules/analytics/repository";
import { BLOG_COLLECTIONS } from "../src/modules/blog/repository";
import { ProjectRepository } from "../src/modules/projects/repository";
import { createProjectsRouter } from "../src/modules/projects/routes";
import { attachCardSummaries } from "../src/modules/projects/summaries";
import { PUBLISHING_COLLECTIONS } from "../src/modules/publishing/repository";
import { testEnv, testLogger } from "./helpers";
import { startTestDatabase, type TestDatabase } from "./mongo";

/**
 * What a site card can say, for a whole page of sites at once.
 *
 * The cost is the point. A card that asked its own questions when it rendered would be one request
 * per site: the list gets slower with every site a customer adds, and the answers land at different
 * times so the page jumps under the reader's hands. These assertions are about the answers being
 * right *and* about them arriving in a fixed number of round trips.
 */

const WORKSPACE = "workspace-a";
const base = `/api/v1/workspaces/${WORKSPACE}/projects`;

let database: TestDatabase;
let app: Express;

beforeAll(async () => {
  database = await startTestDatabase();
  const repository = new ProjectRepository(database.db);
  app = createApp({
    env: testEnv(),
    logger: testLogger(),
    routers: [
      {
        path: "/workspaces/:workspaceId/projects",
        router: createProjectsRouter({
          repository,
          attachCardSummaries: (context, list) => attachCardSummaries(database.db, context, list),
          resolveWorkspace: createSeededWorkspaceResolver({ workspaceId: WORKSPACE, userId: "user-a" }),
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
});

const createProject = async (name: string) =>
  (await request(app).post(base).send({ name })).body.data as { id: string; revision: number };

/** Marks a project live, as a publication does: a version row plus the pointer on the project. */
async function publish(projectId: string, sourceRevision: number) {
  const version = await database.db.collection(PUBLISHING_COLLECTIONS.versions).insertOne({
    workspaceId: WORKSPACE,
    projectId,
    version: 1,
    sourceRevision,
    document: {},
    routes: [],
    redirects: [],
    publishedAt: new Date().toISOString(),
  });
  await database.db
    .collection(COLLECTIONS.projects)
    .updateOne({ _id: new ObjectId(projectId) }, { $set: { activePublishedVersionId: version.insertedId.toHexString() } });
}

const summaryOf = async (projectId: string) => {
  const list = (await request(app).get(base)).body.data as Array<{ id: string; summary?: unknown }>;
  return list.find((row) => row.id === projectId)?.summary as
    | {
        hasPendingChanges: boolean;
        knownBlockers: string[];
        traffic: { state: string; views?: number; visitors?: number | null; days?: number };
      }
    | undefined;
};

describe("pending changes", () => {
  it("says nothing is pending on a site nobody has published", async () => {
    const project = await createProject("Acme");

    // A draft is not "pending publication"; it has never been anywhere to be behind.
    expect(await summaryOf(project.id)).toMatchObject({ hasPendingChanges: false });
  });

  it("reports edits made since the live version was compiled", async () => {
    const project = await createProject("Acme");
    await publish(project.id, project.revision - 1);

    expect(await summaryOf(project.id)).toMatchObject({ hasPendingChanges: true });
  });

  it("reports nothing pending when the live version is the current draft", async () => {
    const project = await createProject("Acme");
    await publish(project.id, project.revision);

    expect(await summaryOf(project.id)).toMatchObject({ hasPendingChanges: false });
  });
});

describe("blockers a grouped query can answer", () => {
  it("names a published site with nowhere to serve it", async () => {
    const project = await createProject("Acme");
    await publish(project.id, project.revision);

    // Publishing again does not fix this, so a card that only said "published" would send somebody
    // to press the button that cannot help.
    expect((await summaryOf(project.id))?.knownBlockers).toContain("no-address");
  });

  it("names a blog that is on but whose layouts were never published", async () => {
    const project = await createProject("Acme");
    await database.db
      .collection(BLOG_COLLECTIONS.settings)
      .insertOne({ workspaceId: WORKSPACE, projectId: project.id, enabled: true, basePath: "/blog" });

    expect((await summaryOf(project.id))?.knownBlockers).toContain("blog-setup");
  });

  it("stops naming it once both layouts are published", async () => {
    const project = await createProject("Acme");
    await database.db
      .collection(BLOG_COLLECTIONS.settings)
      .insertOne({ workspaceId: WORKSPACE, projectId: project.id, enabled: true, basePath: "/blog" });
    for (const kind of ["index", "article"]) {
      await database.db
        .collection("blogTemplates")
        .insertOne({ workspaceId: WORKSPACE, projectId: project.id, kind, publishedVersion: 1 });
    }

    expect((await summaryOf(project.id))?.knownBlockers).not.toContain("blog-setup");
  });

  it("says nothing about a blog nobody turned on", async () => {
    const project = await createProject("Acme");
    expect((await summaryOf(project.id))?.knownBlockers).toEqual([]);
  });
});

describe("traffic", () => {
  it("is unavailable, not zero, on a site that was never published", async () => {
    const project = await createProject("Acme");

    // Nobody has counted anything, which is a different statement from nobody having visited.
    expect(await summaryOf(project.id)).toMatchObject({ traffic: { state: "unavailable" } });
  });

  it("counts server-side views over the window", async () => {
    const project = await createProject("Acme");
    await publish(project.id, project.revision);
    await database.db.collection(ANALYTICS_COLLECTIONS.siteViews).insertMany([
      { workspaceId: WORKSPACE, projectId: project.id, day: utcDay(new Date()), path: "/", views: 7 },
      { workspaceId: WORKSPACE, projectId: project.id, day: utcDay(new Date()), path: "/about", views: 3 },
    ]);

    expect((await summaryOf(project.id))?.traffic).toMatchObject({ state: "measured", views: 10, days: 30 });
  });

  it("leaves out views older than the window", async () => {
    const project = await createProject("Acme");
    await publish(project.id, project.revision);
    const longAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    await database.db
      .collection(ANALYTICS_COLLECTIONS.siteViews)
      .insertOne({ workspaceId: WORKSPACE, projectId: project.id, day: utcDay(longAgo), path: "/", views: 99 });

    expect((await summaryOf(project.id))?.traffic).toMatchObject({ views: 0 });
  });

  it("reports visitors as unknown until the owner turns browser measurement on", async () => {
    const project = await createProject("Acme");
    await publish(project.id, project.revision);

    // Server counting is unconditional; visitors come from the browser and need consent. A site
    // nobody is measuring has not had zero visitors.
    expect((await summaryOf(project.id))?.traffic).toMatchObject({ visitors: null });
  });

  it("counts sessions once measurement is on", async () => {
    const project = await createProject("Acme");
    await publish(project.id, project.revision);
    await database.db
      .collection(ANALYTICS_COLLECTIONS.settings)
      .insertOne({ workspaceId: WORKSPACE, projectId: project.id, enabled: true });
    await database.db.collection(ANALYTICS_COLLECTIONS.sessions).insertMany([
      { workspaceId: WORKSPACE, projectId: project.id, sessionId: "s1", startedAt: new Date() },
      { workspaceId: WORKSPACE, projectId: project.id, sessionId: "s2", startedAt: new Date() },
    ]);

    expect((await summaryOf(project.id))?.traffic).toMatchObject({ visitors: 2 });
  });
});

describe("the cost of the extra detail", () => {
  /** Counts the reads the summary pass issues, whatever the page size is. */
  async function readsForListing(siteCount: number): Promise<number> {
    await database.clear();
    for (let index = 0; index < siteCount; index += 1) await createProject(`Site ${index}`);

    let reads = 0;
    const collection = database.db.collection.bind(database.db);
    const spy = vi.spyOn(database.db, "collection").mockImplementation(((name: string, options?: unknown) => {
      const real = collection(name, options as never) as unknown as Record<string, (...args: unknown[]) => unknown>;
      // Wrapped rather than replaced: the real cursor is still what the route reads from, and only
      // the count of round trips is observed.
      for (const method of ["find", "aggregate"] as const) {
        const original = real[method]!.bind(real);
        real[method] = (...args: unknown[]) => {
          reads += 1;
          return original(...args);
        };
      }
      return real;
    }) as never);

    await request(app).get(base);
    spy.mockRestore();
    return reads;
  }

  it("issues the same number of reads for one site and for ten", async () => {
    const forOne = await readsForListing(1);
    const forTen = await readsForListing(10);

    // The whole shape of this endpoint exists for this line. A per-card request would make the
    // second number roughly ten times the first, and a customer's list slower every time they
    // succeed at something.
    expect(forTen).toBe(forOne);
    expect(forOne).toBeGreaterThan(0);
  });

  it("answers every row in that one pass", async () => {
    await database.clear();
    for (const name of ["One", "Two", "Three", "Four", "Five"]) await createProject(name);

    const response = await request(app).get(base);

    expect(response.body.data).toHaveLength(5);
    for (const row of response.body.data) expect(row.summary).toBeDefined();
  });

  it("answers another workspace's site with nothing rather than this workspace's numbers", async () => {
    const project = await createProject("Acme");
    await publish(project.id, project.revision);
    await database.db
      .collection(ANALYTICS_COLLECTIONS.siteViews)
      .insertOne({ workspaceId: "workspace-b", projectId: project.id, day: utcDay(new Date()), path: "/", views: 500 });

    // The project id is the same string; the workspace is what scopes the count.
    expect((await summaryOf(project.id))?.traffic).toMatchObject({ views: 0 });
  });
});
