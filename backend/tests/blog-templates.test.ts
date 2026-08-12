import { createPage, type BlogFieldDefinition } from "@websitebuilder/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ensureTemplateIndexes, TemplateRepository } from "../src/modules/blog/templates";
import type { WorkspaceContext } from "../src/modules/projects/repository";
import { startTestDatabase, type TestDatabase } from "./mongo";

let database: TestDatabase;
let repository: TemplateRepository;

const tenantA: WorkspaceContext = { workspaceId: "workspace-a", userId: "user-a" };
const tenantB: WorkspaceContext = { workspaceId: "workspace-b", userId: "user-b" };
const PROJECT = "project-1";

const field = (overrides: Partial<BlogFieldDefinition> = {}): BlogFieldDefinition => ({
  id: "f1",
  key: "subtitle",
  label: "Subtitle",
  type: "shortText",
  required: false,
  ...overrides,
});

const posts = [
  { id: "p1", customFieldValues: { f1: "Set" } },
  { id: "p2", customFieldValues: {} },
];

beforeAll(async () => {
  database = await startTestDatabase();
  await ensureTemplateIndexes(database.db);
  repository = new TemplateRepository(database.db);
}, 120_000);

afterAll(async () => {
  await database?.stop();
});

beforeEach(async () => {
  await database.clear();
  await ensureTemplateIndexes(database.db);
});

describe("loadOrCreate", () => {
  it("creates a starter draft with nothing published", async () => {
    const template = await repository.loadOrCreate(tenantA, PROJECT, "article");

    expect(template.draftDocument).toBeDefined();
    expect(template.publishedDocument).toBeUndefined();
    expect(template.draftVersion).toBe(1);
  });

  it("returns the same record on a second load rather than creating another", async () => {
    const first = await repository.loadOrCreate(tenantA, PROJECT, "article");
    const second = await repository.loadOrCreate(tenantA, PROJECT, "article");
    expect(second.id).toBe(first.id);
  });

  it("keeps index and article templates separate", async () => {
    const index = await repository.loadOrCreate(tenantA, PROJECT, "index");
    const article = await repository.loadOrCreate(tenantA, PROJECT, "article");
    expect(index.id).not.toBe(article.id);
  });
});

describe("draft editing", () => {
  it("never changes the live template", async () => {
    await repository.loadOrCreate(tenantA, PROJECT, "article");
    await repository.publish(tenantA, PROJECT, "article", []);

    const published = await repository.findPublished(PROJECT, "article");
    await repository.saveDraft(tenantA, PROJECT, "article", {
      draftDocument: createPage({ name: "Edited draft" }),
      fieldDefinitions: [],
    });

    // The live document is byte-identical until the designer publishes again.
    expect(await repository.findPublished(PROJECT, "article")).toEqual(published);
  });

  it("bumps the draft version on every save", async () => {
    await repository.loadOrCreate(tenantA, PROJECT, "article");
    const saved = await repository.saveDraft(tenantA, PROJECT, "article", {
      draftDocument: createPage({ name: "v2" }),
      fieldDefinitions: [],
    });
    expect(saved?.draftVersion).toBe(2);
  });

  it("does not save a draft across workspaces", async () => {
    await repository.loadOrCreate(tenantA, PROJECT, "article");
    const result = await repository.saveDraft(tenantB, PROJECT, "article", {
      draftDocument: createPage({ name: "Stolen" }),
      fieldDefinitions: [],
    });
    expect(result).toBeNull();
  });
});

describe("publication impact", () => {
  it("reports nothing to fix for an unchanged template", async () => {
    await repository.loadOrCreate(tenantA, PROJECT, "article");
    const impact = await repository.analysePublication(tenantA, PROJECT, "article", posts);

    expect(impact?.issues).toEqual([]);
    expect(impact?.blocked).toBe(false);
  });

  it("blocks a newly required field and names the posts that lack it", async () => {
    await repository.loadOrCreate(tenantA, PROJECT, "article");
    await repository.saveDraft(tenantA, PROJECT, "article", {
      draftDocument: createPage({ name: "Article" }),
      fieldDefinitions: [field({ required: true })],
    });

    const impact = await repository.analysePublication(tenantA, PROJECT, "article", posts);
    expect(impact?.blocked).toBe(true);
    expect(impact?.issues[0]).toMatchObject({ code: "required-field-missing", postIds: ["p2"] });
    expect(impact?.affectedPostCount).toBe(1);
  });

  it("does not block an optional new field, so adding one is always safe", async () => {
    await repository.loadOrCreate(tenantA, PROJECT, "article");
    await repository.saveDraft(tenantA, PROJECT, "article", {
      draftDocument: createPage({ name: "Article" }),
      fieldDefinitions: [field({ id: "f2", required: false })],
    });

    const impact = await repository.analysePublication(tenantA, PROJECT, "article", posts);
    expect(impact?.blocked).toBe(false);
  });
});

describe("publish", () => {
  it("promotes the draft and records the version it came from", async () => {
    await repository.loadOrCreate(tenantA, PROJECT, "article");
    await repository.saveDraft(tenantA, PROJECT, "article", {
      draftDocument: createPage({ name: "Ready" }),
      fieldDefinitions: [field()],
    });

    const result = await repository.publish(tenantA, PROJECT, "article", posts);
    expect(result).toHaveProperty("template");
    if (!("template" in result!)) throw new Error("expected a published template");

    expect(result.template.publishedVersion).toBe(result.template.draftVersion);
    expect(result.template.publishedDocument?.name).toBe("Ready");
    expect(result.template.publishedAt).toBeDefined();
  });

  it("refuses to publish an incompatible template and returns the impact instead", async () => {
    await repository.loadOrCreate(tenantA, PROJECT, "article");
    await repository.saveDraft(tenantA, PROJECT, "article", {
      draftDocument: createPage({ name: "Breaking" }),
      fieldDefinitions: [field({ required: true })],
    });

    const result = await repository.publish(tenantA, PROJECT, "article", posts);
    expect(result).toHaveProperty("impact");
    // Nothing reached the live template.
    expect(await repository.findPublished(PROJECT, "article")).toBeNull();
  });

  it("applies to every existing post because posts do not clone the layout", async () => {
    await repository.loadOrCreate(tenantA, PROJECT, "article");
    await repository.saveDraft(tenantA, PROJECT, "article", {
      draftDocument: createPage({ name: "Shared layout" }),
      fieldDefinitions: [],
    });
    await repository.publish(tenantA, PROJECT, "article", posts);

    // One published document serves all posts; there is no per-post copy to update.
    const published = await repository.findPublished(PROJECT, "article");
    expect(published?.name).toBe("Shared layout");
  });

  it("records the published field definitions so the next impact report is accurate", async () => {
    await repository.loadOrCreate(tenantA, PROJECT, "article");
    await repository.saveDraft(tenantA, PROJECT, "article", {
      draftDocument: createPage({ name: "v1" }),
      fieldDefinitions: [field()],
    });
    await repository.publish(tenantA, PROJECT, "article", posts);

    // Removing the now-published field must be reported next time.
    await repository.saveDraft(tenantA, PROJECT, "article", {
      draftDocument: createPage({ name: "v2" }),
      fieldDefinitions: [],
    });
    const impact = await repository.analysePublication(tenantA, PROJECT, "article", posts);
    expect(impact?.issues[0]?.code).toBe("field-removed");
    expect(impact?.blocked).toBe(false);
  });
});

describe("public reads", () => {
  it("returns nothing before the first publication, so a draft never reaches a visitor", async () => {
    await repository.loadOrCreate(tenantA, PROJECT, "article");
    expect(await repository.findPublished(PROJECT, "article")).toBeNull();
  });
});
