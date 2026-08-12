import { createPage, createProjectDocument, type BuilderDocumentInput } from "@websitebuilder/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ProjectRepository, RevisionConflictError, type WorkspaceContext } from "../src/modules/projects/repository";
import { startTestDatabase, type TestDatabase } from "./mongo";

let database: TestDatabase;
let repository: ProjectRepository;

const tenantA: WorkspaceContext = { workspaceId: "workspace-a", userId: "user-a" };
const tenantB: WorkspaceContext = { workspaceId: "workspace-b", userId: "user-b" };

beforeAll(async () => {
  database = await startTestDatabase();
  repository = new ProjectRepository(database.db);
}, 120_000);

afterAll(async () => {
  await database?.stop();
});

beforeEach(async () => {
  await database.clear();
});

function documentFrom(project: { name: string; slug: string }): BuilderDocumentInput {
  return createProjectDocument(project);
}

describe("create", () => {
  it("creates a project with one Home page and revision 1", async () => {
    const project = await repository.create(tenantA, { name: "Acme Studio" });
    expect(project.id).toMatch(/^[0-9a-f]{24}$/);
    expect(project.workspaceId).toBe("workspace-a");
    expect(project.createdByUserId).toBe("user-a");
    expect(project.revision).toBe(1);
    expect(project.pages).toHaveLength(1);
    expect(project.pages[0]?.isHome).toBe(true);
    expect(project.slug).toBe("acme-studio");
  });

  it("gives a colliding name a distinct platform hostname label", async () => {
    const first = await repository.create(tenantA, { name: "Acme" });
    const second = await repository.create(tenantB, { name: "Acme" });
    expect(first.slug).toBe("acme");
    expect(second.slug).toBe("acme-2");
  });

  it("falls back to a usable slug when the name has no usable characters", async () => {
    const project = await repository.create(tenantA, { name: "!!" });
    expect(project.slug).toBe("site");
  });
});

describe("tenant isolation", () => {
  it("does not return another workspace's project by id", async () => {
    const project = await repository.create(tenantA, { name: "Acme" });
    expect(await repository.findById(tenantB, project.id)).toBeNull();
    expect(await repository.findById(tenantA, project.id)).not.toBeNull();
  });

  it("does not list another workspace's projects", async () => {
    await repository.create(tenantA, { name: "Acme" });
    await repository.create(tenantB, { name: "Globex" });

    expect((await repository.listSummaries(tenantA)).map((p) => p.name)).toEqual(["Acme"]);
    expect((await repository.listSummaries(tenantB)).map((p) => p.name)).toEqual(["Globex"]);
  });

  it("does not rename, save or delete across workspaces", async () => {
    const project = await repository.create(tenantA, { name: "Acme" });

    expect(await repository.rename(tenantB, project.id, "Stolen")).toBeNull();
    expect(await repository.delete(tenantB, project.id)).toBe(false);
    await expect(
      repository.saveDocument(tenantB, project.id, 1, documentFrom({ name: "Stolen", slug: project.slug })),
    ).rejects.toBeInstanceOf(RevisionConflictError);

    const untouched = await repository.findById(tenantA, project.id);
    expect(untouched?.name).toBe("Acme");
  });

  it("treats a malformed id as not found rather than throwing", async () => {
    expect(await repository.findById(tenantA, "not-an-id")).toBeNull();
    expect(await repository.delete(tenantA, "not-an-id")).toBe(false);
  });
});

describe("listSummaries", () => {
  it("returns page counts without loading builder documents", async () => {
    const project = await repository.create(tenantA, { name: "Acme" });
    const document = documentFrom({ name: "Acme", slug: project.slug });
    document.pages.push(createPage({ name: "About", slug: "about", order: 1 }));
    await repository.saveDocument(tenantA, project.id, 1, document);

    const [summary] = await repository.listSummaries(tenantA);
    expect(summary?.pageCount).toBe(2);
    expect(summary).not.toHaveProperty("pages");
  });

  it("filters by client when one is given", async () => {
    await repository.create(tenantA, { name: "Direct site" });
    await repository.create(tenantA, { name: "Client site", clientId: "client-1" });

    const filtered = await repository.listSummaries(tenantA, { clientId: "client-1" });
    expect(filtered.map((p) => p.name)).toEqual(["Client site"]);
  });

  it("orders by most recently updated", async () => {
    const first = await repository.create(tenantA, { name: "First" });
    await repository.create(tenantA, { name: "Second" });
    await repository.rename(tenantA, first.id, "First updated");

    expect((await repository.listSummaries(tenantA)).map((p) => p.name)).toEqual(["First updated", "Second"]);
  });
});

describe("saveDocument revision handling", () => {
  it("increments the revision and updates the timestamp", async () => {
    const project = await repository.create(tenantA, { name: "Acme" });
    const saved = await repository.saveDocument(
      tenantA,
      project.id,
      1,
      documentFrom({ name: "Acme", slug: project.slug }),
    );
    expect(saved.revision).toBe(2);
    expect(saved.updatedAt >= project.updatedAt).toBe(true);
  });

  it("rejects a stale revision instead of overwriting newer data", async () => {
    const project = await repository.create(tenantA, { name: "Acme" });

    const winner = documentFrom({ name: "Winner", slug: project.slug });
    await repository.saveDocument(tenantA, project.id, 1, winner);

    const loser = documentFrom({ name: "Loser", slug: project.slug });
    await expect(repository.saveDocument(tenantA, project.id, 1, loser)).rejects.toMatchObject({
      name: "RevisionConflictError",
      currentRevision: 2,
    });

    const stored = await repository.findById(tenantA, project.id);
    expect(stored?.name).toBe("Winner");
  });

  it("lets only one of two concurrent saves win", async () => {
    const project = await repository.create(tenantA, { name: "Acme" });

    const results = await Promise.allSettled([
      repository.saveDocument(tenantA, project.id, 1, documentFrom({ name: "A", slug: project.slug })),
      repository.saveDocument(tenantA, project.id, 1, documentFrom({ name: "B", slug: project.slug })),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await repository.findById(tenantA, project.id))?.revision).toBe(2);
  });

  it("persists nested page and section edits", async () => {
    const project = await repository.create(tenantA, { name: "Acme" });
    const document = documentFrom({ name: "Acme", slug: project.slug });
    document.pages.push(createPage({ name: "About", slug: "about", order: 1 }));
    await repository.saveDocument(tenantA, project.id, 1, document);

    const reloaded = await repository.findById(tenantA, project.id);
    expect(reloaded?.pages.map((page) => page.slug)).toEqual(["/", "about"]);
    expect(reloaded?.pages[1]?.sections).toHaveLength(1);
  });
});

describe("delete", () => {
  it("removes only the addressed project", async () => {
    const keep = await repository.create(tenantA, { name: "Keep" });
    const remove = await repository.create(tenantA, { name: "Remove" });

    expect(await repository.delete(tenantA, remove.id)).toBe(true);
    expect(await repository.findById(tenantA, remove.id)).toBeNull();
    expect(await repository.findById(tenantA, keep.id)).not.toBeNull();
  });
});
