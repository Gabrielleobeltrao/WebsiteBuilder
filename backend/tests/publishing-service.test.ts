import { createProjectDocument, DEFAULT_BLOG_SETTINGS } from "@websitebuilder/shared";
import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { COLLECTIONS } from "../src/db/indexes";
import { BlogRepository, ensureBlogIndexes } from "../src/modules/blog/repository";
import { MediaRepository } from "../src/modules/media/repository";
import { createGridFsStorage } from "../src/modules/media/storage";
import { ProjectRepository, type WorkspaceContext } from "../src/modules/projects/repository";
import { ensurePublishingIndexes, PublishingRepository } from "../src/modules/publishing/repository";
import { PublishingService } from "../src/modules/publishing/service";
import { startTestDatabase, type TestDatabase } from "./mongo";

let database: TestDatabase;
let projects: ProjectRepository;
let publishing: PublishingRepository;
let blog: BlogRepository;
let service: PublishingService;

const A: WorkspaceContext = { workspaceId: "workspace-a", userId: "user-a" };

async function newProject() {
  return projects.create(A, { name: "Acme" });
}

/** Saves the document at its current revision, returning the new revision. */
async function edit(projectId: string, mutate: (document: ReturnType<typeof createProjectDocument>) => void) {
  const project = await projects.findById(A, projectId);
  const { id, workspaceId, createdByUserId, revision, createdAt, updatedAt, ...document } = project!;
  mutate(document as ReturnType<typeof createProjectDocument>);
  const saved = await projects.saveDocument(A, projectId, revision, document as ReturnType<typeof createProjectDocument>);
  return saved!.revision;
}

beforeAll(async () => {
  database = await startTestDatabase();
  projects = new ProjectRepository(database.db);
  publishing = new PublishingRepository(database.db, database.db.collection(COLLECTIONS.projects));
  blog = new BlogRepository(database.db);
  service = new PublishingService({
    projects,
    publishing,
    blog,
    media: new MediaRepository(database.db, createGridFsStorage(database.db)),
    collectModuleFacts: async ({ workspaceId, projectId }) => {
      const settings = await blog.loadSettings({ workspaceId, userId: "" }, projectId);
      return {
        blog: {
          hasRecords: false,
          explicitlyActivated: settings.enabled,
          blockingIssueCount: settings.enabled && settings.articleTemplateId === undefined ? 1 : 0,
          warningCount: 0,
        },
      };
    },
  });
}, 120_000);

afterAll(async () => {
  await database.stop();
});

beforeEach(async () => {
  await database.clear();
  await ensureBlogIndexes(database.db);
  await ensurePublishingIndexes(database.db);
});

describe("publish", () => {
  it("makes a project live and records what it was compiled from", async () => {
    const project = await newProject();
    const outcome = await service.publish(A, project.id);

    expect(outcome.status).toBe("published");
    if (outcome.status !== "published") return;
    expect(outcome.version.sourceRevision).toBe(project.revision);
    expect(outcome.version.routes.some((route) => route.path === "/")).toBe(true);
  });

  it("does not create a second version when nothing changed", async () => {
    const project = await newProject();
    const first = await service.publish(A, project.id);
    const again = await service.publish(A, project.id);

    expect(again.status).toBe("published");
    if (first.status !== "published" || again.status !== "published") return;
    expect(again.unchanged).toBe(true);
    expect(again.version.id).toBe(first.version.id);
    expect(await publishing.history(A, project.id)).toHaveLength(1);
  });

  it("creates a new version once the content actually changes", async () => {
    const project = await newProject();
    await service.publish(A, project.id);
    await edit(project.id, (document) => {
      document.seo.siteName = "Renamed";
    });

    const second = await service.publish(A, project.id);
    expect(second.status).toBe("published");
    if (second.status !== "published") return;
    expect(second.unchanged).toBe(false);
    expect(second.version.version).toBe(2);
  });

  it("reports a project the workspace does not own as missing", async () => {
    const project = await newProject();
    expect((await service.publish({ workspaceId: "other", userId: "u" }, project.id)).status).toBe("not-found");
  });
});

describe("blocked publications", () => {
  it("refuses to publish while a module in use is incomplete, and leaves nothing live", async () => {
    const project = await newProject();
    await blog.saveSettings(A, project.id, { ...DEFAULT_BLOG_SETTINGS, enabled: true });

    const outcome = await service.publish(A, project.id);

    expect(outcome.status).toBe("blocked");
    if (outcome.status !== "blocked") return;
    expect(outcome.report.issues.map((issue) => issue.code)).toContain("module-incomplete");
    expect(await publishing.history(A, project.id)).toEqual([]);
    expect(await publishing.findActiveForProject(project.id)).toBeNull();
  });

  it("refuses when the site references media the workspace does not own", async () => {
    const project = await newProject();
    await edit(project.id, (document) => {
      document.seo.defaultSocialMediaId = new ObjectId().toHexString();
    });

    const outcome = await service.publish(A, project.id);
    expect(outcome.status).toBe("blocked");
    if (outcome.status !== "blocked") return;
    expect(outcome.report.issues.map((issue) => issue.code)).toContain("missing-media");
  });

  it("keeps the previous version live when a later publish is blocked", async () => {
    const project = await newProject();
    const first = await service.publish(A, project.id);
    await blog.saveSettings(A, project.id, { ...DEFAULT_BLOG_SETTINGS, enabled: true });

    expect((await service.publish(A, project.id)).status).toBe("blocked");

    if (first.status !== "published") return;
    // A failed build must not degrade a running site.
    expect((await publishing.findActiveForProject(project.id))?.id).toBe(first.version.id);
  });
});

describe("preflight", () => {
  it("reports blockers without publishing anything", async () => {
    const project = await newProject();
    await blog.saveSettings(A, project.id, { ...DEFAULT_BLOG_SETTINGS, enabled: true });

    const result = await service.preflight(A, project.id);

    expect(result?.report.blocked).toBe(true);
    expect(await publishing.history(A, project.id)).toEqual([]);
  });

  it("reports a publishable site as clear", async () => {
    const project = await newProject();
    const result = await service.preflight(A, project.id);

    expect(result?.report.blocked).toBe(false);
    expect(result?.report.routeCount).toBeGreaterThan(0);
  });
});
