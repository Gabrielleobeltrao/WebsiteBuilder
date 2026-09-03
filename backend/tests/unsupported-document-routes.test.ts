import { createProjectDocument, SCHEMA_VERSION } from "@websitebuilder/shared";
import { legacyProjectDocument } from "@websitebuilder/shared/legacy-fixtures";
import type { Express } from "express";
import { ObjectId } from "mongodb";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { COLLECTIONS } from "../src/db/indexes";
import { createSeededWorkspaceResolver } from "../src/middleware/workspace";
import { BlogRepository } from "../src/modules/blog/repository";
import { MediaRepository } from "../src/modules/media/repository";
import { createGridFsStorage } from "../src/modules/media/storage";
import { ProjectRepository } from "../src/modules/projects/repository";
import { createProjectsRouter } from "../src/modules/projects/routes";
import { DomainService } from "../src/modules/domains/service";
import { UnconfiguredHostnameProvider } from "../src/modules/domains/unconfiguredProvider";
import { ensurePublishingIndexes, PublishingRepository } from "../src/modules/publishing/repository";
import { createPublishingRouter } from "../src/modules/publishing/routes";
import { PublishingService } from "../src/modules/publishing/service";
import { testEnv, testLogger } from "./helpers";
import { startTestDatabase, type TestDatabase } from "./mongo";

/**
 * What every route says about a document this build cannot act on.
 *
 * The answer has to be the same one everywhere, and it has to be distinguishable from "there is no
 * such project". A save reported 404 — telling a customer their site did not exist when it existed
 * and could not be parsed — and preflight, preview and publish reported 500, which is the API saying
 * it crashed rather than that it refused.
 *
 * These go through the HTTP routes rather than the repository, because the defect was never in the
 * repository: it was in what the layers above it did with the error.
 */
let database: TestDatabase;
let app: Express;
let projects: ProjectRepository;

const WORKSPACE = "workspace-a";
const projectsBase = `/api/v1/workspaces/${WORKSPACE}/projects`;
const publishingBase = (projectId: string) => `${projectsBase}/${projectId}/publishing`;

beforeAll(async () => {
  database = await startTestDatabase();
  projects = new ProjectRepository(database.db);
  const publishing = new PublishingRepository(database.db, database.db.collection(COLLECTIONS.projects));
  const resolveWorkspace = createSeededWorkspaceResolver({ workspaceId: WORKSPACE, userId: "user-a" });

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
            blog: new BlogRepository(database.db),
            media: new MediaRepository(database.db, createGridFsStorage(database.db)),
          }),
          repository: publishing,
          domains: new DomainService(database.db, new UnconfiguredHostnameProvider(), "example.test"),
          resolveWorkspace,
          platformRootDomain: "example.test",
          reservedSubdomains: [],
          publicOrigin: "https://app.example.test",
        }),
      },
      { path: "/workspaces/:workspaceId/projects", router: createProjectsRouter({ repository: projects, resolveWorkspace }) },
    ],
  });
}, 120_000);

afterAll(async () => {
  await database?.stop();
});

beforeEach(async () => {
  await database.clear();
  await ensurePublishingIndexes(database.db);
});

/** Stages a stored record in a shape the write path would never have accepted. */
async function storedProject(patch: Record<string, unknown>) {
  const created = await projects.create({ workspaceId: WORKSPACE, userId: "user-a" }, { name: "Site" });
  await database.db
    .collection(COLLECTIONS.projects)
    .updateOne({ _id: new ObjectId(created.id) }, { $set: patch });
  return created.id;
}

const futureDocument = () => storedProject({ schemaVersion: SCHEMA_VERSION + 1 });

const invalidDocument = async () => {
  const legacy = legacyProjectDocument();
  (legacy.pages[0]!.sections[0]!.elements[0] as { geometry: unknown }).geometry = "not a geometry";
  return storedProject({ pages: legacy.pages, sharedSections: legacy.sharedSections });
};

describe("a project that is not there", () => {
  it("is still a 404 on read", async () => {
    const response = await request(app).get(`${projectsBase}/${new ObjectId().toHexString()}`);
    expect(response.status).toBe(404);
  });

  it("is still a 404 on save", async () => {
    const response = await request(app)
      .put(`${projectsBase}/${new ObjectId().toHexString()}/document`)
      .send({ revision: 1, document: createProjectDocument({ name: "X", slug: "x-site" }) });

    expect([404, 409]).toContain(response.status);
    if (response.status === 409) expect(response.body.error.code).toBe("REVISION_CONFLICT");
  });
});

for (const [label, stage] of [
  ["written by a newer build", futureDocument],
  ["no longer parsing", invalidDocument],
] as const) {
  describe(`a document ${label}`, () => {
    it("answers 409 UNSUPPORTED_DOCUMENT on read, not 404", async () => {
      const projectId = await stage();
      const response = await request(app).get(`${projectsBase}/${projectId}`);

      // 404 told a customer their site did not exist. It exists; this build cannot read it.
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("UNSUPPORTED_DOCUMENT");
    });

    it("answers 409 UNSUPPORTED_DOCUMENT on save", async () => {
      const projectId = await stage();
      const response = await request(app)
        .put(`${projectsBase}/${projectId}/document`)
        .send({ revision: 1, document: createProjectDocument({ name: "X", slug: "x-site" }) });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("UNSUPPORTED_DOCUMENT");
    });

    for (const [route, path] of [
      ["preflight", (id: string) => `${publishingBase(id)}/preflight`],
      ["preview", (id: string) => `${publishingBase(id)}/preview`],
    ] as const) {
      it(`answers 409 UNSUPPORTED_DOCUMENT on ${route}, not 500`, async () => {
        const projectId = await stage();
        const response = await request(app).get(path(projectId));

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe("UNSUPPORTED_DOCUMENT");
      });
    }

    it("answers 409 UNSUPPORTED_DOCUMENT on publish, not 500", async () => {
      const projectId = await stage();
      const response = await request(app).post(`${publishingBase(projectId)}`);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("UNSUPPORTED_DOCUMENT");
    });
  });
}

describe("what the refusal says", () => {
  it("names the page, section and element, so the block can be found", async () => {
    const projectId = await invalidDocument();
    const response = await request(app).get(`${projectsBase}/${projectId}`);

    const paths = (response.body.error.details ?? []).map((detail: { path: string }) => detail.path);
    expect(paths.join(" ")).toContain("legacy-section");
    expect(paths.join(" ")).toContain("legacy-top-level");
  });

  it("carries no content from the document", async () => {
    const projectId = await invalidDocument();
    const response = await request(app).get(`${projectsBase}/${projectId}`);

    // Ids and schema messages only. An error body is the one place a customer's own copy would
    // travel into a log collector.
    const body = JSON.stringify(response.body);
    expect(body).not.toContain("Top level paragraph");
    expect(body).not.toContain("Paragraph in a shared section");
  });
});
