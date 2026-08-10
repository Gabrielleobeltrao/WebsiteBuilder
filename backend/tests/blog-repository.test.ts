import { DEFAULT_BLOG_SETTINGS, EMPTY_RICH_TEXT, type BlogPostInput } from "@websitebuilder/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { BlogRepository, ensureBlogIndexes, SlugTakenError } from "../src/modules/blog/repository";
import type { WorkspaceContext } from "../src/modules/projects/repository";
import { startTestDatabase, type TestDatabase } from "./mongo";

let database: TestDatabase;
let repository: BlogRepository;

const tenantA: WorkspaceContext = { workspaceId: "workspace-a", userId: "user-a" };
const tenantB: WorkspaceContext = { workspaceId: "workspace-b", userId: "user-b" };
const PROJECT = "project-1";
const OTHER_PROJECT = "project-2";

const post = (overrides: Partial<BlogPostInput> = {}): BlogPostInput => ({
  title: "First post",
  slug: "",
  excerpt: "",
  content: EMPTY_RICH_TEXT,
  categoryIds: [],
  tags: [],
  customFieldValues: {},
  status: "draft",
  ...overrides,
});

beforeAll(async () => {
  database = await startTestDatabase();
  await ensureBlogIndexes(database.db);
  repository = new BlogRepository(database.db);
}, 120_000);

afterAll(async () => {
  await database.stop();
});

beforeEach(async () => {
  await database.clear();
  await ensureBlogIndexes(database.db);
});

describe("settings", () => {
  it("starts disabled for a project that never enabled the blog", async () => {
    expect(await repository.loadSettings(tenantA, PROJECT)).toEqual(DEFAULT_BLOG_SETTINGS);
  });

  it("persists settings per project", async () => {
    await repository.saveSettings(tenantA, PROJECT, { ...DEFAULT_BLOG_SETTINGS, enabled: true, basePath: "/news" });

    expect((await repository.loadSettings(tenantA, PROJECT)).basePath).toBe("/news");
    expect((await repository.loadSettings(tenantA, OTHER_PROJECT)).enabled).toBe(false);
  });

  it("keeps posts when the blog is disabled, because hiding routes is not deleting an archive", async () => {
    await repository.saveSettings(tenantA, PROJECT, { ...DEFAULT_BLOG_SETTINGS, enabled: true });
    await repository.create(tenantA, PROJECT, post({ status: "published" }));

    await repository.saveSettings(tenantA, PROJECT, { ...DEFAULT_BLOG_SETTINGS, enabled: false });
    expect((await repository.list(tenantA, PROJECT)).total).toBe(1);
  });

  it("does not leak settings across workspaces", async () => {
    await repository.saveSettings(tenantA, PROJECT, { ...DEFAULT_BLOG_SETTINGS, enabled: true, basePath: "/news" });
    expect((await repository.loadSettings(tenantB, PROJECT)).basePath).toBe("/blog");
  });
});

describe("create", () => {
  it("derives a slug from the title when none is given", async () => {
    const created = await repository.create(tenantA, PROJECT, post({ title: "Nosso Primeiro Artigo" }));
    expect(created.slug).toBe("nosso-primeiro-artigo");
    expect(created.status).toBe("draft");
    expect(created.publishedAt).toBeUndefined();
  });

  it("stamps publishedAt only when created as published", async () => {
    const created = await repository.create(tenantA, PROJECT, post({ status: "published" }));
    expect(created.publishedAt).toBeDefined();
  });

  it("suffixes a colliding slug instead of failing the save", async () => {
    await repository.create(tenantA, PROJECT, post({ title: "Hello" }));
    const second = await repository.create(tenantA, PROJECT, post({ title: "Hello" }));
    expect(second.slug).toBe("hello-2");
  });

  it("lets two different projects use the same slug", async () => {
    const first = await repository.create(tenantA, PROJECT, post({ title: "Hello" }));
    const second = await repository.create(tenantA, OTHER_PROJECT, post({ title: "Hello" }));
    expect(first.slug).toBe("hello");
    expect(second.slug).toBe("hello");
  });
});

describe("tenant and project isolation", () => {
  it("does not read a post from another workspace", async () => {
    const created = await repository.create(tenantA, PROJECT, post());
    expect(await repository.findById(tenantB, PROJECT, created.id)).toBeNull();
  });

  it("does not read a post through another project id", async () => {
    const created = await repository.create(tenantA, PROJECT, post());
    expect(await repository.findById(tenantA, OTHER_PROJECT, created.id)).toBeNull();
  });

  it("does not update, publish or delete across tenants", async () => {
    const created = await repository.create(tenantA, PROJECT, post());

    expect(await repository.update(tenantB, PROJECT, created.id, post({ title: "Stolen" }))).toBeNull();
    expect(await repository.setStatus(tenantB, PROJECT, created.id, "published")).toBeNull();
    expect(await repository.delete(tenantB, PROJECT, created.id)).toBe(false);

    const untouched = await repository.findById(tenantA, PROJECT, created.id);
    expect(untouched?.title).toBe("First post");
    expect(untouched?.status).toBe("draft");
  });

  it("treats a malformed id as not found", async () => {
    expect(await repository.findById(tenantA, PROJECT, "nope")).toBeNull();
    expect(await repository.delete(tenantA, PROJECT, "nope")).toBe(false);
  });
});

describe("public reads", () => {
  it("never resolves a draft by slug", async () => {
    const draft = await repository.create(tenantA, PROJECT, post({ title: "Secret" }));
    expect(await repository.findPublishedBySlug(PROJECT, draft.slug)).toBeNull();

    await repository.setStatus(tenantA, PROJECT, draft.id, "published");
    expect(await repository.findPublishedBySlug(PROJECT, draft.slug)).not.toBeNull();
  });

  it("lists only published posts, newest first", async () => {
    await repository.create(tenantA, PROJECT, post({ title: "Draft" }));
    const first = await repository.create(tenantA, PROJECT, post({ title: "Older", status: "published" }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await repository.create(tenantA, PROJECT, post({ title: "Newer", status: "published" }));

    const published = await repository.listPublished(PROJECT);
    expect(published.total).toBe(2);
    expect(published.items[0]?.title).toBe("Newer");
    expect(published.items.some((item) => item.id === first.id)).toBe(true);
  });

  it("does not return another project's published posts", async () => {
    await repository.create(tenantA, PROJECT, post({ status: "published" }));
    expect((await repository.listPublished(OTHER_PROJECT)).total).toBe(0);
  });
});

describe("update and publish", () => {
  it("keeps the original publish date when a published post is edited again", async () => {
    const created = await repository.create(tenantA, PROJECT, post({ status: "published" }));
    const first = created.publishedAt;

    await new Promise((resolve) => setTimeout(resolve, 5));
    const updated = await repository.update(tenantA, PROJECT, created.id, post({ title: "Edited", status: "published" }));
    expect(updated?.publishedAt).toBe(first);
  });

  it("unpublishing then republishing keeps the first publication date", async () => {
    const created = await repository.create(tenantA, PROJECT, post({ status: "published" }));
    const first = created.publishedAt;

    await repository.setStatus(tenantA, PROJECT, created.id, "draft");
    const republished = await repository.setStatus(tenantA, PROJECT, created.id, "published");
    expect(republished?.publishedAt).toBe(first);
  });

  it("keeps custom values keyed by field id through a rename", async () => {
    const created = await repository.create(
      tenantA,
      PROJECT,
      post({ customFieldValues: { "field-1": "Original subtitle" } }),
    );
    const updated = await repository.update(
      tenantA,
      PROJECT,
      created.id,
      post({ title: "Edited", customFieldValues: { "field-1": "Original subtitle" } }),
    );
    expect(updated?.customFieldValues["field-1"]).toBe("Original subtitle");
  });

  it("rejects a slug already taken by another post in the same blog", async () => {
    await repository.create(tenantA, PROJECT, post({ title: "Taken" }));
    const other = await repository.create(tenantA, PROJECT, post({ title: "Other" }));

    const updated = await repository.update(tenantA, PROJECT, other.id, post({ title: "Other", slug: "taken" }));
    expect(updated?.slug).toBe("taken-2");
  });

  it("lets a post keep its own slug when saved unchanged", async () => {
    const created = await repository.create(tenantA, PROJECT, post({ title: "Stable" }));
    const updated = await repository.update(tenantA, PROJECT, created.id, post({ title: "Stable", slug: "stable" }));
    expect(updated?.slug).toBe("stable");
  });
});

describe("listing", () => {
  it("filters by status and paginates", async () => {
    for (let index = 0; index < 5; index += 1) {
      await repository.create(tenantA, PROJECT, post({ title: `Post ${index}`, status: index < 3 ? "published" : "draft" }));
    }

    expect((await repository.list(tenantA, PROJECT, { status: "published" })).total).toBe(3);
    const paged = await repository.list(tenantA, PROJECT, { perPage: 2, page: 2 });
    expect(paged.items).toHaveLength(2);
    expect(paged.total).toBe(5);
  });

  it("searches titles without letting the query act as a pattern", async () => {
    await repository.create(tenantA, PROJECT, post({ title: "Release notes" }));
    await repository.create(tenantA, PROJECT, post({ title: "Other" }));

    expect((await repository.list(tenantA, PROJECT, { search: "release" })).total).toBe(1);
    // A regex metacharacter must match literally, not blow up or match everything.
    expect((await repository.list(tenantA, PROJECT, { search: ".*" })).total).toBe(0);
  });

  it("filters by category", async () => {
    await repository.create(tenantA, PROJECT, post({ title: "Tagged", categoryIds: ["cat-1"] }));
    await repository.create(tenantA, PROJECT, post({ title: "Untagged" }));

    expect((await repository.list(tenantA, PROJECT, { categoryId: "cat-1" })).total).toBe(1);
  });
});

describe("SlugTakenError", () => {
  it("is exported for the API layer to map", () => {
    expect(new SlugTakenError("x").name).toBe("SlugTakenError");
  });
});
