import type { RouteManifestEntry } from "@websitebuilder/shared";
import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { COLLECTIONS } from "../src/db/indexes";
import { ensurePublishingIndexes, PublishError, PublishingRepository } from "../src/modules/publishing/repository";
import { ProjectRepository, type WorkspaceContext } from "../src/modules/projects/repository";
import { startTestDatabase, type TestDatabase } from "./mongo";

let database: TestDatabase;
let publishing: PublishingRepository;
let projects: ProjectRepository;

const A: WorkspaceContext = { workspaceId: "workspace-a", userId: "user-a" };
const B: WorkspaceContext = { workspaceId: "workspace-b", userId: "user-b" };

const route = (path: string): RouteManifestEntry => ({
  path,
  kind: "page",
  resourceId: path,
  statusCode: 200,
  seo: {},
});

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  sourceRevision: 1,
  schemaVersion: 1,
  document: { pages: [{ id: "home" }] },
  routes: [route("/")],
  redirects: [],
  referencedMediaIds: [],
  ...overrides,
});

const projectCollection = () =>
  database.db.collection<{ _id: ObjectId; workspaceId: string; activePublishedVersionId?: string; revision: number }>(
    COLLECTIONS.projects,
  );

const activeVersionId = async (projectId: string) =>
  (await projectCollection().findOne({ _id: new ObjectId(projectId) }))?.activePublishedVersionId;

beforeAll(async () => {
  database = await startTestDatabase();
  await ensurePublishingIndexes(database.db);
  projects = new ProjectRepository(database.db);
  publishing = new PublishingRepository(database.db, projectCollection());
}, 120_000);

afterAll(async () => {
  await database.stop();
});

beforeEach(async () => {
  await database.clear();
  await ensurePublishingIndexes(database.db);
});

describe("publish", () => {
  it("creates version 1 and activates it", async () => {
    const project = await projects.create(A, { name: "Acme" });
    const version = await publishing.publish(A, project.id, snapshot({ sourceRevision: project.revision }));

    expect(version.version).toBe(1);
    expect(await activeVersionId(project.id)).toBe(version.id);
  });

  it("increments the version on each publish", async () => {
    const project = await projects.create(A, { name: "Acme" });
    await publishing.publish(A, project.id, snapshot({ sourceRevision: project.revision }));

    const reloaded = await projects.findById(A, project.id);
    const second = await publishing.publish(A, project.id, snapshot({ sourceRevision: reloaded!.revision }));
    expect(second.version).toBe(2);
  });

  it("refuses when the project moved on while the snapshot was compiling", async () => {
    const project = await projects.create(A, { name: "Acme" });

    await expect(
      publishing.publish(A, project.id, snapshot({ sourceRevision: project.revision + 5 })),
    ).rejects.toMatchObject({ reason: "revision-changed" });

    // Nothing became live: a stale snapshot must not reach visitors.
    expect(await activeVersionId(project.id)).toBeUndefined();
  });

  it("produces the same content hash for identical content", async () => {
    const project = await projects.create(A, { name: "Acme" });
    const first = await publishing.publish(A, project.id, snapshot({ sourceRevision: project.revision }));

    const reloaded = await projects.findById(A, project.id);
    const second = await publishing.publish(A, project.id, snapshot({ sourceRevision: reloaded!.revision }));
    expect(second.contentHash).toBe(first.contentHash);
  });

  it("does not publish into another workspace's project", async () => {
    const project = await projects.create(A, { name: "Acme" });
    await expect(
      publishing.publish(B, project.id, snapshot({ sourceRevision: project.revision })),
    ).rejects.toBeInstanceOf(PublishError);
  });
});

describe("immutability and rollback", () => {
  it("keeps every version readable after later publishes", async () => {
    const project = await projects.create(A, { name: "Acme" });
    const first = await publishing.publish(A, project.id, snapshot({ sourceRevision: project.revision }));

    const reloaded = await projects.findById(A, project.id);
    await publishing.publish(
      A,
      project.id,
      snapshot({ sourceRevision: reloaded!.revision, document: { pages: [{ id: "changed" }] } }),
    );

    const stored = await publishing.findActive(project.id, first.id);
    expect(stored?.document).toEqual({ pages: [{ id: "home" }] });
  });

  it("rolls back by moving the pointer, leaving both snapshots untouched", async () => {
    const project = await projects.create(A, { name: "Acme" });
    const first = await publishing.publish(A, project.id, snapshot({ sourceRevision: project.revision }));

    const reloaded = await projects.findById(A, project.id);
    const second = await publishing.publish(
      A,
      project.id,
      snapshot({ sourceRevision: reloaded!.revision, document: { pages: [{ id: "v2" }] } }),
    );

    await publishing.rollback(A, project.id, first.id);
    expect(await activeVersionId(project.id)).toBe(first.id);

    // Neither version changed.
    expect((await publishing.findActive(project.id, first.id))?.version).toBe(1);
    expect((await publishing.findActive(project.id, second.id))?.version).toBe(2);
  });

  it("refuses to roll back to another workspace's version", async () => {
    const project = await projects.create(A, { name: "Acme" });
    const version = await publishing.publish(A, project.id, snapshot({ sourceRevision: project.revision }));

    await expect(publishing.rollback(B, project.id, version.id)).rejects.toMatchObject({ reason: "not-found" });
  });

  it("lists history newest first without the stored document", async () => {
    const project = await projects.create(A, { name: "Acme" });
    await publishing.publish(A, project.id, snapshot({ sourceRevision: project.revision }));
    const reloaded = await projects.findById(A, project.id);
    await publishing.publish(A, project.id, snapshot({ sourceRevision: reloaded!.revision }));

    const history = await publishing.history(A, project.id);
    expect(history.map((version) => version.version)).toEqual([2, 1]);
    expect(history[0]?.document).toBeUndefined();
  });
});

describe("retention", () => {
  it("never deletes the version currently being served", async () => {
    const project = await projects.create(A, { name: "Acme" });
    let active = "";
    for (let index = 0; index < 4; index += 1) {
      const reloaded = await projects.findById(A, project.id);
      const version = await publishing.publish(A, project.id, snapshot({ sourceRevision: reloaded!.revision }));
      active = version.id;
    }

    await publishing.rollback(A, project.id, (await publishing.history(A, project.id)).at(-1)!.id);
    const oldest = await activeVersionId(project.id);

    const deleted = await publishing.pruneVersions(A, project.id, 2, oldest);
    expect(deleted).toBeGreaterThan(0);
    expect(await publishing.findActive(project.id, oldest!)).not.toBeNull();
    expect(active).not.toBe("");
  });
});

describe("platform domains", () => {
  it("creates exactly one hostname per project, idempotently", async () => {
    const project = await projects.create(A, { name: "Acme Studio" });

    const first = await publishing.ensurePlatformDomain(A, project.id, project.slug, "osistema.com");
    const second = await publishing.ensurePlatformDomain(A, project.id, project.slug, "osistema.com");

    expect(first?.hostname).toBe("acme-studio.osistema.com");
    expect(second?.id).toBe(first?.id);
    expect(await publishing.listDomains(A, project.id)).toHaveLength(1);
  });

  it("refuses a reserved infrastructure label", async () => {
    const project = await projects.create(A, { name: "Acme" });
    expect(await publishing.ensurePlatformDomain(A, project.id, "api", "osistema.com")).toBeNull();
  });

  it("refuses to hand one hostname to a second project", async () => {
    const first = await projects.create(A, { name: "Acme" });
    const second = await projects.create(A, { name: "Other" });

    await publishing.ensurePlatformDomain(A, first.id, "shared", "osistema.com");
    await expect(
      publishing.ensurePlatformDomain(A, second.id, "shared", "osistema.com"),
    ).rejects.toMatchObject({ reason: "hostname-taken" });
  });

  it("resolves a public host only when it is live", async () => {
    const project = await projects.create(A, { name: "Acme" });
    await publishing.ensurePlatformDomain(A, project.id, project.slug, "osistema.com");

    expect((await publishing.resolvePublicHost("acme.osistema.com"))?.projectId).toBe(project.id);
    expect(await publishing.resolvePublicHost("unknown.osistema.com")).toBeNull();
  });

  it("does not list another workspace's domains", async () => {
    const project = await projects.create(A, { name: "Acme" });
    await publishing.ensurePlatformDomain(A, project.id, project.slug, "osistema.com");
    expect(await publishing.listDomains(B, project.id)).toEqual([]);
  });
});
