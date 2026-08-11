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

describe("retention", () => {
  it("keeps only the configured number of versions and never the one being served", async () => {
    const retaining = new PublishingService({
      projects,
      publishing,
      blog,
      media: new MediaRepository(database.db, createGridFsStorage(database.db)),
      retentionCount: 2,
    });

    const project = await projects.create(A, { name: "Acme" });
    for (const name of ["one", "two", "three", "four"]) {
      const reloaded = await projects.findById(A, project.id);
      const { id, workspaceId, createdByUserId, revision, createdAt, updatedAt, ...document } = reloaded!;
      const typed = document as ReturnType<typeof createProjectDocument>;
      typed.seo.siteName = name;
      await projects.saveDocument(A, project.id, revision, typed);
      await retaining.publish(A, project.id);
    }

    const remaining = await publishing.history(A, project.id);
    expect(remaining).toHaveLength(2);

    const active = await publishing.findActiveForProject(project.id);
    expect(remaining.map((version) => version.id)).toContain(active?.id);
  });
});

describe("what a pruned version takes with it", () => {
  /** A service whose retention is tight enough that publishing twice prunes something. */
  const withRetention = (onVersionsPruned: PublishingService["deps"]["onVersionsPruned"]) =>
    new PublishingService({
      projects,
      publishing,
      blog,
      media: new MediaRepository(database.db, createGridFsStorage(database.db)),
      retentionCount: 1,
      ...(onVersionsPruned === undefined ? {} : { onVersionsPruned }),
    });

  it("tells the caller which layouts stopped existing", async () => {
    const pruned: string[] = [];
    const tight = withRetention(async (_context, _projectId, versionIds) => {
      pruned.push(...versionIds);
    });

    const project = await newProject();
    const first = await tight.publish(A, project.id);
    await edit(project.id, (document) => (document.pages[0]!.seo.title = "Changed"));
    await tight.publish(A, project.id);
    await edit(project.id, (document) => (document.pages[0]!.seo.title = "Changed again"));
    await tight.publish(A, project.id);

    // Heatmap coordinates are stored against a version; the ones whose version is gone can only be
    // drawn over a layout that did not produce them, so the caller is told to delete them.
    expect(first.status).toBe("published");
    expect(pruned.length).toBeGreaterThan(0);
    if (first.status === "published") expect(pruned).toContain(first.version.id);
  });

  it("publishes the site even when tidying up afterwards fails", async () => {
    // A site that refuses to go live because its old statistics could not be cleaned up would be a
    // bad trade in every direction.
    const tight = withRetention(async () => {
      throw new Error("the analytics database is unreachable");
    });

    const project = await newProject();
    await tight.publish(A, project.id);
    await edit(project.id, (document) => (document.pages[0]!.seo.title = "Changed"));
    await edit(project.id, (document) => (document.pages[0]!.seo.title = "Changed twice"));

    const result = await tight.publish(A, project.id);

    expect(result.status).toBe("published");
    expect(await publishing.findActiveVersionId(project.id)).not.toBeNull();
  });

  it("does not call the hook when nothing was pruned", async () => {
    let calls = 0;
    const service = new PublishingService({
      projects,
      publishing,
      blog,
      media: new MediaRepository(database.db, createGridFsStorage(database.db)),
      retentionCount: 20,
      onVersionsPruned: async () => {
        calls += 1;
      },
    });

    const project = await newProject();
    await service.publish(A, project.id);

    expect(calls).toBe(0);
  });
});
