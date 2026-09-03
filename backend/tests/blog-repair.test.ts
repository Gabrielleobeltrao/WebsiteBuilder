import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { auditBlogTemplates, repairBlogTemplates } from "../src/modules/blog/repair";
import { formatAudit } from "../src/scripts/audit-blog-templates";
import { BlogRepository, ensureBlogIndexes } from "../src/modules/blog/repository";
import { ensureTemplateIndexes, TemplateRepository } from "../src/modules/blog/templates";
import type { WorkspaceContext } from "../src/modules/projects/repository";
import { startTestDatabase, type TestDatabase } from "./mongo";

/**
 * The repair itself, and the audit that measures how much of it is needed.
 *
 * The API tests cover what a person sees. These cover the two properties the operation has to hold
 * on its own: running it twice does nothing the second time, and one tenant's blog is never touched
 * by another tenant's repair.
 */
let database: TestDatabase;
let repository: BlogRepository;
let templates: TemplateRepository;

const A: WorkspaceContext = { workspaceId: "workspace-a", userId: "user-a" };
const B: WorkspaceContext = { workspaceId: "workspace-b", userId: "user-b" };
const PROJECT = "aaaaaaaaaaaaaaaaaaaaaaaa";

beforeAll(async () => {
  database = await startTestDatabase();
  repository = new BlogRepository(database.db);
  templates = new TemplateRepository(database.db);
}, 120_000);

afterAll(async () => {
  await database?.stop();
});

beforeEach(async () => {
  await database.clear();
  await ensureBlogIndexes(database.db);
  await ensureTemplateIndexes(database.db);
});

/** A blog turned on the way the old settings write did it: a flag and no template references. */
async function legacyBlog(context: WorkspaceContext, projectId = PROJECT) {
  const settings = await repository.loadSettings(context, projectId);
  await repository.saveSettings(context, projectId, { ...settings, enabled: true });
}

const deps = () => ({ repository, templates });

describe("repairing one blog", () => {
  it("reports what was missing and fills both references", async () => {
    await legacyBlog(A);

    const result = await repairBlogTemplates(deps(), A, PROJECT);

    expect(result.missing).toEqual(["index", "article"]);
    expect(result.repaired).toBe(true);
    expect(result.settings.indexTemplateId).toEqual(expect.any(String));
    expect(result.settings.articleTemplateId).toEqual(expect.any(String));
  });

  it("does nothing the second time", async () => {
    await legacyBlog(A);
    const first = await repairBlogTemplates(deps(), A, PROJECT);

    const second = await repairBlogTemplates(deps(), A, PROJECT);

    expect(second.repaired).toBe(false);
    expect(second.missing).toEqual([]);
    // The same templates, not a second pair: recreating them would orphan whatever was designed.
    expect(second.settings.indexTemplateId).toBe(first.settings.indexTemplateId);
    expect(second.settings.articleTemplateId).toBe(first.settings.articleTemplateId);
  });

  it("leaves a blog nobody turned on untouched", async () => {
    const result = await repairBlogTemplates(deps(), A, PROJECT);

    expect(result.repaired).toBe(false);
    expect(result.settings.enabled).toBe(false);
    expect(result.settings.indexTemplateId).toBeUndefined();
  });

  it("turns a blog on and repairs it in one step when a format is given", async () => {
    const result = await repairBlogTemplates(deps(), A, PROJECT, { format: "magazine" });

    expect(result.settings.enabled).toBe(true);
    expect(result.settings.format).toBe("magazine");
    expect(result.settings.articleTemplateId).toEqual(expect.any(String));
  });

  it("publishes the starters, so a repaired blog serves something", async () => {
    await legacyBlog(A);
    await repairBlogTemplates(deps(), A, PROJECT);

    expect(await templates.findPublished(PROJECT, "article")).not.toBeNull();
    expect(await templates.findPublished(PROJECT, "index")).not.toBeNull();
  });

  it("repairs only the tenant that asked", async () => {
    await legacyBlog(A);
    await legacyBlog(B);

    await repairBlogTemplates(deps(), A, PROJECT);

    // Same project id, different workspace: one tenant's repair must not reach into another's.
    const theirs = await repository.loadSettings(B, PROJECT);
    expect(theirs.indexTemplateId).toBeUndefined();
  });
});

describe("the dry-run audit", () => {
  it("finds affected blogs without changing any of them", async () => {
    await legacyBlog(A);

    const before = await repository.loadSettings(A, PROJECT);
    const found = await auditBlogTemplates({ repository });

    expect(found).toEqual([{ workspaceId: A.workspaceId, projectId: PROJECT, missing: ["index", "article"] }]);
    // The point of a dry run: discovering the size of the problem must not be the same act as fixing it.
    expect(await repository.loadSettings(A, PROJECT)).toEqual(before);
  });

  it("stops listing a blog once it is repaired", async () => {
    await legacyBlog(A);
    await repairBlogTemplates(deps(), A, PROJECT);

    expect(await auditBlogTemplates({ repository })).toEqual([]);
  });

  it("ignores blogs nobody turned on", async () => {
    await repository.loadSettings(A, PROJECT);
    expect(await auditBlogTemplates({ repository })).toEqual([]);
  });

  it("narrows to one workspace when asked", async () => {
    await legacyBlog(A);
    await legacyBlog(B);

    const found = await auditBlogTemplates({ repository }, { workspaceId: B.workspaceId });

    expect(found.map((candidate) => candidate.workspaceId)).toEqual([B.workspaceId]);
  });
});

describe("the operator's audit output", () => {
  it("says plainly when nothing is broken", () => {
    expect(formatAudit([])).toBe("No blog is missing a layout.");
  });

  it("names every site and which layout it is missing", () => {
    const text = formatAudit([
      { workspaceId: "w1", projectId: "p1", missing: ["index"] },
      { workspaceId: "w1", projectId: "p2", missing: ["index", "article"] },
    ]);

    expect(text).toContain("2 blog(s)");
    expect(text).toContain("w1\tp1\tmissing: index");
    expect(text).toContain("w1\tp2\tmissing: index, article");
  });
});
