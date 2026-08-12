import { createPage, createProjectDocument } from "@websitebuilder/shared";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { COLLECTIONS } from "../src/db/indexes";
import { BlogRepository } from "../src/modules/blog/repository";
import { MediaRepository } from "../src/modules/media/repository";
import { createGridFsStorage } from "../src/modules/media/storage";
import { ensurePublishingIndexes, PublishingRepository } from "../src/modules/publishing/repository";
import { PublishingService } from "../src/modules/publishing/service";
import { createSeededWorkspaceResolver } from "../src/middleware/workspace";
import { ProjectRepository } from "../src/modules/projects/repository";
import { createProjectsRouter } from "../src/modules/projects/routes";
import { testEnv, testLogger } from "./helpers";
import { startTestDatabase, type TestDatabase } from "./mongo";

const WORKSPACE = "workspace-a";
const OTHER_WORKSPACE = "workspace-b";
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

async function createProject(name = "Acme") {
  const response = await request(app).post(base).send({ name });
  expect(response.status).toBe(201);
  return response.body.data as { id: string; slug: string; revision: number };
}

describe("POST /projects", () => {
  it("creates a project and returns 201 with the success envelope", async () => {
    const response = await request(app).post(base).send({ name: "Acme Studio" });
    expect(response.status).toBe(201);
    expect(response.body.data.name).toBe("Acme Studio");
    expect(response.body.data.pages).toHaveLength(1);
    expect(Object.keys(response.body)).toEqual(["data"]);
  });

  it("rejects an empty name with a field-level validation error", async () => {
    const response = await request(app).post(base).send({ name: "   " });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.details[0].path).toBe("name");
  });

  it("rejects unknown properties instead of storing them", async () => {
    const response = await request(app).post(base).send({ name: "Acme", workspaceId: OTHER_WORKSPACE });
    expect(response.status).toBe(400);
  });
});

describe("GET /projects", () => {
  it("lists summaries without builder documents", async () => {
    await createProject("Acme");
    const response = await request(app).get(base);
    expect(response.status).toBe(200);
    expect(response.body.data[0].pageCount).toBe(1);
    expect(response.body.data[0]).not.toHaveProperty("pages");
  });

  it("returns an empty array rather than 404 when nothing exists", async () => {
    const response = await request(app).get(base);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });
});

describe("GET /projects/:projectId", () => {
  it("returns the complete builder document", async () => {
    const created = await createProject();
    const response = await request(app).get(`${base}/${created.id}`);
    expect(response.status).toBe(200);
    expect(response.body.data.pages[0].sections).toHaveLength(1);
  });

  it("answers a malformed id with 404, not a validation error", async () => {
    const response = await request(app).get(`${base}/not-an-id`);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("answers an unknown but well-formed id with 404", async () => {
    const response = await request(app).get(`${base}/aaaaaaaaaaaaaaaaaaaaaaaa`);
    expect(response.status).toBe(404);
  });
});

describe("PUT /projects/:projectId/document", () => {
  it("saves a document and increments the revision", async () => {
    const created = await createProject();
    const document = createProjectDocument({ name: "Acme", slug: created.slug });
    document.pages.push(createPage({ name: "About", slug: "about", order: 1 }));

    const response = await request(app)
      .put(`${base}/${created.id}/document`)
      .send({ revision: created.revision, document });

    expect(response.status).toBe(200);
    expect(response.body.data.revision).toBe(2);
    expect(response.body.data.pages).toHaveLength(2);
  });

  it("returns 409 REVISION_CONFLICT for a stale save and does not overwrite", async () => {
    const created = await createProject();
    const first = createProjectDocument({ name: "Winner", slug: created.slug });
    await request(app).put(`${base}/${created.id}/document`).send({ revision: 1, document: first });

    const second = createProjectDocument({ name: "Loser", slug: created.slug });
    const response = await request(app)
      .put(`${base}/${created.id}/document`)
      .send({ revision: 1, document: second });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("REVISION_CONFLICT");
    expect(response.body.error.details[0].message).toContain("2");

    const reloaded = await request(app).get(`${base}/${created.id}`);
    expect(reloaded.body.data.name).toBe("Winner");
  });

  it("rejects a document carrying a dangerous link", async () => {
    const created = await createProject();
    const document = createProjectDocument({ name: "Acme", slug: created.slug });
    const section = document.pages[0]?.sections[0];
    if (!section) throw new Error("fixture is missing its section");
    section.elements.push({
      id: "11111111-1111-4111-8111-111111111111",
      type: "button",
      name: "Bad",
      text: "Click",
      link: { kind: "external", url: "javascript:alert(1)", newTab: false },
      geometry: { x: 0, y: 0, width: 180, height: 48, rotation: 0 },
      responsiveLayout: {
        width: { value: 180, unit: "px" },
        height: { value: 48, unit: "px" },
        horizontalConstraint: "left",
        verticalConstraint: "top",
        visible: true,
      },
      zIndex: 1,
      locked: false,
      hidden: false,
      style: {
        fontSize: { value: 16, unit: "px" },
        fontWeight: 600,
        textColor: "#ffffff",
        backgroundColor: "#12806f",
        borderRadius: 6,
        horizontalAlign: "center",
      },
    });

    const response = await request(app)
      .put(`${base}/${created.id}/document`)
      .send({ revision: 1, document });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("refuses to change the project slug through the document endpoint", async () => {
    const created = await createProject();
    const document = createProjectDocument({ name: "Acme", slug: "different-slug" });
    const response = await request(app)
      .put(`${base}/${created.id}/document`)
      .send({ revision: 1, document });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].path).toBe("document.slug");
  });

  it("rejects a document whose schema version is unknown", async () => {
    const created = await createProject();
    const document = { ...createProjectDocument({ name: "Acme", slug: created.slug }), schemaVersion: 99 };
    const response = await request(app)
      .put(`${base}/${created.id}/document`)
      .send({ revision: 1, document });

    expect(response.status).toBe(400);
  });
});

describe("PATCH and DELETE", () => {
  it("renames a project", async () => {
    const created = await createProject();
    const response = await request(app).patch(`${base}/${created.id}`).send({ name: "Renamed" });
    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe("Renamed");
  });

  it("deletes a project and answers a repeat delete with 404", async () => {
    const created = await createProject();
    expect((await request(app).delete(`${base}/${created.id}`)).status).toBe(204);
    expect((await request(app).delete(`${base}/${created.id}`)).status).toBe(404);
  });
});

describe("workspace scoping", () => {
  it("refuses a request addressed to a workspace the caller is not in", async () => {
    const created = await createProject();
    const otherBase = `/api/v1/workspaces/${OTHER_WORKSPACE}/projects`;

    expect((await request(app).get(otherBase)).status).toBe(403);
    expect((await request(app).get(`${otherBase}/${created.id}`)).status).toBe(403);
    expect((await request(app).delete(`${otherBase}/${created.id}`)).status).toBe(403);
  });

  it("does not reveal whether a project exists in another workspace", async () => {
    const created = await createProject();
    const response = await request(app).get(`/api/v1/workspaces/${OTHER_WORKSPACE}/projects/${created.id}`);
    expect(response.body.error.code).toBe("FORBIDDEN");
    expect(JSON.stringify(response.body)).not.toContain("Acme");
  });
});

describe("the address a visitor can open", () => {
  it("is absent for a site that was never published", async () => {
    await createProject("Unpublished");

    const response = await request(app).get(base);

    // A link to a page that does not exist yet teaches a customer the product is broken, when what
    // happened is that they have not published.
    expect(response.body.data[0]).not.toHaveProperty("liveUrl");
  });

  it("appears once the site is both published and addressable", async () => {
    const project = await createProject("Live");
    const context = { workspaceId: WORKSPACE, userId: "user-a" };

    const publishing = new PublishingRepository(database.db, database.db.collection(COLLECTIONS.projects));
    const service = new PublishingService({
      projects: new ProjectRepository(database.db),
      publishing,
      blog: new BlogRepository(database.db),
      media: new MediaRepository(database.db, createGridFsStorage(database.db)),
    });
    await ensurePublishingIndexes(database.db);

    const published = await service.publish(context, project.id);
    expect(published.status).toBe("published");
    await publishing.ensurePlatformDomain(context, project.id, "live", "example.test");

    const response = await request(app).get(base);
    expect(response.body.data[0].liveUrl).toBe("https://live.example.test");
  });

  it("stays absent while the site is published but has no live address", async () => {
    const project = await createProject("Published only");
    const context = { workspaceId: WORKSPACE, userId: "user-a" };

    const publishing = new PublishingRepository(database.db, database.db.collection(COLLECTIONS.projects));
    await ensurePublishingIndexes(database.db);
    await new PublishingService({
      projects: new ProjectRepository(database.db),
      publishing,
      blog: new BlogRepository(database.db),
      media: new MediaRepository(database.db, createGridFsStorage(database.db)),
    }).publish(context, project.id);

    // Both facts are required: a published version with nowhere to serve it is not a live site.
    const response = await request(app).get(base);
    expect(response.body.data[0]).not.toHaveProperty("liveUrl");
  });
});
