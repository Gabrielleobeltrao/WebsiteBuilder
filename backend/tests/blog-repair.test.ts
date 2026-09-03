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

/**
 * What the repair is allowed to publish.
 *
 * It used to load-or-create both layouts and publish both, whatever was actually wrong. So a
 * customer with a designed article layout and only the index reference missing had their unfinished
 * article draft promoted onto every post of their live site — by the act of opening the blog screen,
 * which is where the repair runs.
 */
describe("what the repair promotes", () => {
  const enabled = { enabled: true, basePath: "/blog", postsPerPage: 10 } as const;

  /** A layout the customer has designed and deliberately not published. */
  async function designedButUnpublished(kind: "index" | "article") {
    const template = await templates.loadOrCreate(A, PROJECT, kind);
    await templates.saveDraft(
      A,
      PROJECT,
      kind,
      { draftDocument: { ...template.draftDocument, name: "Half finished" }, fieldDefinitions: [] },
      template.draftVersion,
    );
    return templates.loadOrCreate(A, PROJECT, kind);
  }

  it("creates and publishes only the layout whose reference is missing", async () => {
    const article = await designedButUnpublished("article");
    await repository.saveSettings(A, PROJECT, { ...enabled, articleTemplateId: article.id });

    const result = await repairBlogTemplates({ repository, templates }, A, PROJECT);

    expect(result.missing).toEqual(["index"]);
    expect(result.published).toEqual(["index"]);
    // The draft the customer is still working on is untouched and still unpublished.
    expect((await templates.loadOrCreate(A, PROJECT, "article")).publishedDocument).toBeUndefined();
  });

  it("does the same when it is the article reference that is missing", async () => {
    const index = await designedButUnpublished("index");
    await repository.saveSettings(A, PROJECT, { ...enabled, indexTemplateId: index.id });

    const result = await repairBlogTemplates({ repository, templates }, A, PROJECT);

    expect(result.missing).toEqual(["article"]);
    expect(result.published).toEqual(["article"]);
    expect((await templates.loadOrCreate(A, PROJECT, "index")).publishedDocument).toBeUndefined();
  });

  it("never promotes a draft over a layout that is already live", async () => {
    const article = await templates.loadOrCreate(A, PROJECT, "article");
    await templates.publish(A, PROJECT, "article", []);
    const live = await templates.loadOrCreate(A, PROJECT, "article");

    // Edited since, and not published: the live article must keep serving the older version.
    await templates.saveDraft(
      A,
      PROJECT,
      "article",
      { draftDocument: { ...article.draftDocument, name: "Not approved" }, fieldDefinitions: [] },
      live.draftVersion,
    );
    await repository.saveSettings(A, PROJECT, { ...enabled, articleTemplateId: article.id });

    await repairBlogTemplates({ repository, templates }, A, PROJECT);

    const after = await templates.loadOrCreate(A, PROJECT, "article");
    expect(after.publishedVersion).toBe(live.publishedVersion);
    expect(JSON.stringify(after.publishedDocument)).not.toContain("Not approved");
  });

  it("publishes both starters when it is turning a blog on from nothing", async () => {
    const result = await repairBlogTemplates({ repository, templates }, A, PROJECT, { format: "grid" });

    // Nothing existed, so both were created here and both are safe to publish.
    expect(result.published.sort()).toEqual(["article", "index"]);
    expect(result.settings.format).toBe("grid");
  });

  it("publishes nothing at all when no reference is missing", async () => {
    const [index, article] = await Promise.all([
      templates.loadOrCreate(A, PROJECT, "index"),
      templates.loadOrCreate(A, PROJECT, "article"),
    ]);
    await repository.saveSettings(A, PROJECT, {
      ...enabled,
      indexTemplateId: index.id,
      articleTemplateId: article.id,
    });

    const result = await repairBlogTemplates({ repository, templates }, A, PROJECT);

    expect(result).toMatchObject({ missing: [], published: [], repaired: false });
    expect((await templates.loadOrCreate(A, PROJECT, "index")).publishedDocument).toBeUndefined();
  });

  it("promotes nothing on a second activation", async () => {
    await repairBlogTemplates({ repository, templates }, A, PROJECT, { format: "list" });
    const before = await templates.loadOrCreate(A, PROJECT, "article");

    // Somebody redesigns the article and leaves it unpublished, then activation is pressed again.
    await templates.saveDraft(
      A,
      PROJECT,
      "article",
      { draftDocument: { ...before.draftDocument, name: "Redesigned" }, fieldDefinitions: [] },
      before.draftVersion,
    );
    const result = await repairBlogTemplates({ repository, templates }, A, PROJECT, { format: "magazine" });

    expect(result.published).toEqual([]);
    expect(JSON.stringify((await templates.loadOrCreate(A, PROJECT, "article")).publishedDocument)).not.toContain(
      "Redesigned",
    );
  });

  it("creates one starter when two repairs run at once", async () => {
    await repository.saveSettings(A, PROJECT, enabled);

    const [first, second] = await Promise.all([
      repairBlogTemplates({ repository, templates }, A, PROJECT),
      repairBlogTemplates({ repository, templates }, A, PROJECT),
    ]);

    // Exactly one of them created each layout, so exactly one publish happened for each.
    const published = [...first.published, ...second.published].sort();
    expect(published).toEqual(["article", "index"]);
    expect(await database.db.collection("blogTemplates").countDocuments({ projectId: PROJECT })).toBe(2);
  });

  it("leaves another workspace's layouts alone", async () => {
    const theirProject = "bbbbbbbbbbbbbbbbbbbbbbbb";
    await repository.saveSettings(B, theirProject, enabled);
    const theirs = await templates.loadOrCreate(B, theirProject, "article");
    await repository.saveSettings(A, PROJECT, enabled);

    await repairBlogTemplates({ repository, templates }, A, PROJECT);

    // A repair is scoped to one project of one workspace, and publishes only what it created there.
    const after = await templates.loadOrCreate(B, theirProject, "article");
    expect(after.id).toBe(theirs.id);
    expect(after.publishedDocument).toBeUndefined();
    expect((await repository.loadSettings(B, theirProject)).articleTemplateId).toBeUndefined();
  });

  it("refuses rather than hand back a layout belonging to another workspace", async () => {
    // The uniqueness that would refuse the insert is `{projectId, kind}` and carries no workspace,
    // so recovering by re-reading without one would return the other tenant's row.
    await templates.loadOrCreate(B, PROJECT, "article");

    await expect(templates.createStarterIfMissing(A, PROJECT, "article")).rejects.toThrow();
  });
});
