import { createProjectDocument, DEFAULT_FORM_PRESENTATION } from "@websitebuilder/shared";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { COLLECTIONS } from "../src/db/indexes";
import { createSeededWorkspaceResolver } from "../src/middleware/workspace";
import { ProjectRepository, type WorkspaceContext } from "../src/modules/projects/repository";
import { createProjectsRouter } from "../src/modules/projects/routes";
import { ensurePublishingIndexes, PublishingRepository } from "../src/modules/publishing/repository";
import { testEnv, testLogger } from "./helpers";
import { startTestDatabase, type TestDatabase } from "./mongo";

/**
 * What the site dashboard is told about a site's readiness.
 *
 * It used to be handed an empty object, so every category read "not checked" and the panel could say
 * nothing else — while four audits sat in the codebase, written and unused. The rule that shapes
 * this is narrow: a category may be reported clean only when it actually ran, because a tick that
 * came from nobody looking is worse than no tick at all.
 */
let database: TestDatabase;
let projects: ProjectRepository;
let publishing: PublishingRepository;
let app: Express;
let ownedMedia = new Set<string>();

const A: WorkspaceContext = { workspaceId: "workspace-a", userId: "user-a" };
const base = `/api/v1/workspaces/${A.workspaceId}/projects`;

beforeAll(async () => {
  database = await startTestDatabase();
  projects = new ProjectRepository(database.db);
  publishing = new PublishingRepository(database.db, database.db.collection(COLLECTIONS.projects));

  app = createApp({
    env: testEnv(),
    logger: testLogger(),
    routers: [
      {
        path: "/workspaces/:workspaceId/projects",
        router: createProjectsRouter({
          repository: projects,
          resolveWorkspace: createSeededWorkspaceResolver({ workspaceId: A.workspaceId, userId: A.userId }),
          loadOwnedMediaIds: async () => ownedMedia,
          loadActivePublication: async ({ workspaceId, projectId }) => {
            const active = await publishing.findActiveForProject(projectId);
            if (active === null || active.workspaceId !== workspaceId) return null;
            return { sourceRevision: active.sourceRevision, publishedAt: active.createdAt };
          },
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
  await ensurePublishingIndexes(database.db);
  ownedMedia = new Set<string>();
});

const statusOf = (projectId: string) => request(app).get(`${base}/${projectId}/status`);

/** A project whose home page carries a form block pointing at nothing. */
async function projectWithBrokenBlock() {
  const project = await projects.create(A, { name: "Readiness" });
  const loaded = await projects.findById(A, project.id);
  const { id, workspaceId, createdByUserId, revision, createdAt, updatedAt, ...document } = loaded!;
  const typed = document as ReturnType<typeof createProjectDocument>;

  typed.pages[0]!.sections[0]!.elements = [
    {
      id: "orphan-form",
      name: "",
      type: "form",
      version: 2,
      formId: "",
      presentation: DEFAULT_FORM_PRESENTATION,
      geometry: { x: 0, y: 0, width: 480, height: 360, rotation: 0 },
      responsiveLayout: {
        width: { value: 480, unit: "px" },
        height: { value: 360, unit: "px" },
        horizontalConstraint: "left",
        verticalConstraint: "top",
        visible: true,
      },
      zIndex: 1,
      locked: false,
      hidden: false,
    } as never,
  ];

  const saved = await projects.saveDocument(A, project.id, revision, typed);
  return { projectId: project.id, revision: saved.revision };
}

describe("the readiness the dashboard receives", () => {
  it("reports the categories that ran, bound to the revision they ran against", async () => {
    const project = await projects.create(A, { name: "Fresh" });
    const response = await statusOf(project.id);

    expect(response.status).toBe(200);
    for (const category of ["layout", "accessibility", "links", "content"]) {
      expect(response.body.data.readiness[category], category).toMatchObject({
        status: "checked",
        sourceRevision: project.revision,
      });
    }
  });

  it("leaves performance not checked rather than reporting it clean", async () => {
    const project = await projects.create(A, { name: "Fresh" });
    const response = await statusOf(project.id);

    // It is measured against built route assets, which do not exist inside a request. Absent is the
    // honest answer; a green tick would be a lie with a tick beside it.
    expect(response.body.data.readiness.performance).toBeUndefined();
  });

  it("finds the block a person has to fix, and names where it is", async () => {
    const { projectId } = await projectWithBrokenBlock();
    const response = await statusOf(projectId);

    const findings = response.body.data.readiness.content.findings as Array<{ elementId?: string; path: string }>;
    expect(findings.some((finding) => finding.elementId === "orphan-form")).toBe(true);
    expect(findings.every((finding) => typeof finding.path === "string")).toBe(true);
  });

  it("moves with the document, so a rerun never mixes revisions", async () => {
    const { projectId, revision } = await projectWithBrokenBlock();
    const first = await statusOf(projectId);
    expect(first.body.data.readiness.content.sourceRevision).toBe(revision);

    const loaded = await projects.findById(A, projectId);
    const { id, workspaceId, createdByUserId, revision: current, createdAt, updatedAt, ...document } = loaded!;
    (document as ReturnType<typeof createProjectDocument>).pages[0]!.sections[0]!.elements = [];
    await projects.saveDocument(A, projectId, current, document as never);

    const second = await statusOf(projectId);
    expect(second.body.data.readiness.content.sourceRevision).toBe(current + 1);
    expect(second.body.data.readiness.content.findings).toEqual([]);
  });
});

describe("what is waiting to be published", () => {
  it("says a never-published site has work waiting", async () => {
    const project = await projects.create(A, { name: "Unpublished" });
    const response = await statusOf(project.id);

    expect(response.body.data.activeSourceRevision).toBeNull();
    expect(response.body.data.publicationState).toBe("pending");
  });

  it("cannot say a snapshot published before change tracking is up to date, and says so", async () => {
    const { projectId, revision } = await projectWithBrokenBlock();
    await publishing.publish(A, projectId, {
      sourceRevision: revision,
      schemaVersion: 1,
      document: (await projects.findById(A, projectId))!,
      routes: [],
      redirects: [],
      referencedMediaIds: [],
      contentHash: "abc",
    } as never);

    /*
     * Published straight through the repository, the way every version written before source
     * fingerprints existed was: there is nothing recorded to compare the blog against, so "up to
     * date" would be a claim about posts and layouts this snapshot never described.
     */
    expect((await statusOf(projectId)).body.data.publicationState).toBe("unknown");

    const loaded = await projects.findById(A, projectId);
    const { id, workspaceId, createdByUserId, revision: current, createdAt, updatedAt, ...document } = loaded!;
    await projects.saveDocument(A, projectId, current, document as never);

    // The revision moved, which is the one thing an old snapshot can still prove.
    expect((await statusOf(projectId)).body.data.publicationState).toBe("pending");
  });
});
