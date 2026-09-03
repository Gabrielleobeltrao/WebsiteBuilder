import { createProjectDocument, SCHEMA_VERSION } from "@websitebuilder/shared";
import { legacyProjectDocument } from "@websitebuilder/shared/legacy-fixtures";
import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { COLLECTIONS } from "../src/db/indexes";
import { BlogRepository } from "../src/modules/blog/repository";
import { MediaRepository } from "../src/modules/media/repository";
import { createGridFsStorage } from "../src/modules/media/storage";
import {
  ProjectRepository,
  UnsupportedDocumentError,
  type WorkspaceContext,
} from "../src/modules/projects/repository";
import { ensurePublishingIndexes, PublishingRepository } from "../src/modules/publishing/repository";
import { PublishingService } from "../src/modules/publishing/service";
import { startTestDatabase, type TestDatabase } from "./mongo";

/**
 * What a stored record is allowed to do to this build.
 *
 * Writes were validated from the first commit and reads were trusted, so a document written by a
 * newer deployment, or one that had drifted, reached the editor, the compiler and the public
 * renderer as though it were current. The dangerous half is not the read: it is the write that
 * follows, which replaces work this build never understood, and the publication that freezes it into
 * something a visitor sees.
 */
let database: TestDatabase;
let projects: ProjectRepository;
let service: PublishingService;

const A: WorkspaceContext = { workspaceId: "workspace-a", userId: "user-a" };
const B: WorkspaceContext = { workspaceId: "workspace-b", userId: "user-b" };

beforeAll(async () => {
  database = await startTestDatabase();
  projects = new ProjectRepository(database.db);
  const publishing = new PublishingRepository(database.db, database.db.collection(COLLECTIONS.projects));
  service = new PublishingService({
    projects,
    publishing,
    blog: new BlogRepository(database.db),
    media: new MediaRepository(database.db, createGridFsStorage(database.db)),
  });
}, 120_000);

afterAll(async () => {
  await database?.stop();
});

beforeEach(async () => {
  await database.clear();
  await ensurePublishingIndexes(database.db);
});

/** Writes a record straight into Mongo, which is the only way to stage a shape a write would refuse. */
async function storeRaw(context: WorkspaceContext, patch: Record<string, unknown>) {
  const project = await projects.create(context, { name: "Site" });
  await database.db
    .collection(COLLECTIONS.projects)
    .updateOne({ _id: new ObjectId(project.id) }, { $set: patch });
  return project.id;
}

describe("reading a stored document", () => {
  it("opens an old one, migrated in memory, without rewriting the record", async () => {
    const legacy = legacyProjectDocument();
    const projectId = await storeRaw(A, { pages: legacy.pages, sharedSections: legacy.sharedSections });

    const opened = await projects.findById(A, projectId);
    expect(opened).not.toBeNull();

    // The stored record still says what it said: a read migrates for this process and nothing else.
    const raw = await database.db.collection(COLLECTIONS.projects).findOne({ _id: new ObjectId(projectId) });
    expect(JSON.stringify(raw)).toContain("legacy-top-level");
  });

  it("stays scoped to the workspace that asked", async () => {
    const projectId = await storeRaw(A, {});
    expect(await projects.diagnose(B, projectId)).toBeNull();
  });

  it("reports a newer deployment's document as future rather than parsing it as current", async () => {
    const projectId = await storeRaw(A, { schemaVersion: SCHEMA_VERSION + 1 });

    const diagnosis = await projects.diagnose(A, projectId);
    expect(diagnosis?.status).toBe("future");
  });
});

describe("writing over a stored document", () => {
  it("refuses to replace one a newer deployment wrote", async () => {
    const projectId = await storeRaw(A, { schemaVersion: SCHEMA_VERSION + 1 });
    const replacement = createProjectDocument({ name: "Replacement", slug: "replacement" });

    await expect(projects.saveDocument(A, projectId, 1, replacement)).rejects.toBeInstanceOf(
      UnsupportedDocumentError,
    );

    // And the record is untouched, which is the point: the alternative is a successful-looking save
    // that destroyed work the person could not see.
    const raw = await database.db.collection(COLLECTIONS.projects).findOne({ _id: new ObjectId(projectId) });
    expect(raw?.name).toBe("Site");
  });

  it("refuses one that no longer parses, and says where", async () => {
    const legacy = legacyProjectDocument();
    (legacy.pages[0]!.sections[0]!.elements[0] as { geometry: unknown }).geometry = "not a geometry";
    const projectId = await storeRaw(A, { pages: legacy.pages, sharedSections: legacy.sharedSections });

    await expect(
      projects.saveDocument(A, projectId, 1, createProjectDocument({ name: "X", slug: "x-site" })),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof UnsupportedDocumentError &&
        error.diagnosis.issues.some((issue) => issue.path.elementId === "legacy-top-level"),
    );
  });

  it("still saves over an ordinary document", async () => {
    const projectId = await storeRaw(A, {});
    const next = createProjectDocument({ name: "Renamed", slug: "renamed-site" });

    const saved = await projects.saveDocument(A, projectId, 1, next);
    expect(saved.name).toBe("Renamed");
  });
});

describe("publishing a stored document", () => {
  it("refuses to freeze a newer deployment's document into a public snapshot", async () => {
    const projectId = await storeRaw(A, { schemaVersion: SCHEMA_VERSION + 1 });

    await expect(service.publish(A, projectId)).rejects.toBeInstanceOf(UnsupportedDocumentError);
  });
});
