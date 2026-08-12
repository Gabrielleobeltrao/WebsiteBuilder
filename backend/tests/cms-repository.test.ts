import type { CmsField } from "@websitebuilder/shared";
import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { CmsError, CmsRepository, ensureCmsIndexes } from "../src/modules/cms/repository";
import type { WorkspaceContext } from "../src/modules/projects/repository";
import { startTestDatabase, type TestDatabase } from "./mongo";

let database: TestDatabase;
let cms: CmsRepository;

const A: WorkspaceContext = { workspaceId: "workspace-a", userId: "user-a" };
const B: WorkspaceContext = { workspaceId: "workspace-b", userId: "user-b" };
const PROJECT = new ObjectId().toHexString();

const field = (overrides: Partial<CmsField> = {}): CmsField =>
  ({ id: "f-title", key: "title", label: "Title", type: "shortText", required: false, ...overrides }) as CmsField;

const collectionInput = (overrides: Record<string, unknown> = {}) => ({
  name: "Projects",
  slug: "projects",
  fields: [field()],
  ...overrides,
});

beforeAll(async () => {
  database = await startTestDatabase();
  cms = new CmsRepository(database.db);
}, 120_000);

afterAll(async () => {
  await database?.stop();
});

beforeEach(async () => {
  await database.clear();
  await ensureCmsIndexes(database.db);
});

describe("collections", () => {
  it("normalises the slug that becomes the public path", async () => {
    const collection = await cms.createCollection(A, PROJECT, collectionInput({ name: "Case Studies", slug: "Case Studies!" }));
    expect(collection.slug).toBe("case-studies");
  });

  it("refuses a second collection with the same slug in one project", async () => {
    await cms.createCollection(A, PROJECT, collectionInput());
    await expect(cms.createCollection(A, PROJECT, collectionInput())).rejects.toMatchObject({ reason: "slug-taken" });
  });

  it("does not list another workspace's collections", async () => {
    await cms.createCollection(A, PROJECT, collectionInput());
    expect(await cms.listCollections(B, PROJECT)).toEqual([]);
  });
});

describe("schema changes", () => {
  it("keeps values whose field was removed", async () => {
    const collection = await cms.createCollection(A, PROJECT, collectionInput({
      fields: [field(), field({ id: "f-note", key: "note", label: "Note" })],
    }));
    const item = await cms.createItem(A, PROJECT, collection.id, {
      slug: "one",
      status: "draft",
      values: { "f-title": "One", "f-note": "keep me" },
    });

    await cms.updateCollection(A, PROJECT, collection.id, collectionInput({ fields: [field()] }));

    // Invisible until the field returns, but not gone: an accidental removal must be recoverable.
    const stored = await cms.findItem(A, PROJECT, item.id);
    expect(stored?.values["f-note"]).toBe("keep me");
  });

  it("reports a removal that affects published items without blocking it", async () => {
    const collection = await cms.createCollection(A, PROJECT, collectionInput({
      fields: [field(), field({ id: "f-note", key: "note", label: "Note" })],
    }));
    await cms.createItem(A, PROJECT, collection.id, {
      slug: "one",
      status: "published",
      values: { "f-title": "One", "f-note": "text" },
    });

    const { issues } = await cms.updateCollection(A, PROJECT, collection.id, collectionInput({ fields: [field()] }));
    expect(issues.map((issue) => issue.code)).toContain("field-removed");
  });

  it("refuses a newly required field that published items cannot satisfy", async () => {
    const collection = await cms.createCollection(A, PROJECT, collectionInput());
    await cms.createItem(A, PROJECT, collection.id, { slug: "one", status: "published", values: { "f-title": "One" } });

    const withRequired = collectionInput({
      fields: [field(), field({ id: "f-body", key: "body", label: "Body", required: true })],
    });

    // The items are already public; there is no moment at which a site should serve content its own
    // schema rejects.
    await expect(cms.updateCollection(A, PROJECT, collection.id, withRequired)).rejects.toMatchObject({
      reason: "schema-change-blocked",
    });
  });

  it("allows the same change when only drafts would be affected", async () => {
    const collection = await cms.createCollection(A, PROJECT, collectionInput());
    await cms.createItem(A, PROJECT, collection.id, { slug: "one", status: "draft", values: { "f-title": "One" } });

    const withRequired = collectionInput({
      fields: [field(), field({ id: "f-body", key: "body", label: "Body", required: true })],
    });

    await expect(cms.updateCollection(A, PROJECT, collection.id, withRequired)).resolves.toBeDefined();
  });
});

describe("items", () => {
  const setup = async () => cms.createCollection(A, PROJECT, collectionInput({ fields: [field({ required: true })] }));

  it("refuses an item missing a required value", async () => {
    const collection = await setup();
    await expect(
      cms.createItem(A, PROJECT, collection.id, { slug: "one", status: "draft", values: {} }),
    ).rejects.toMatchObject({ reason: "invalid-item" });
  });

  it("refuses a value of the wrong type rather than coercing it", async () => {
    const collection = await cms.createCollection(A, PROJECT, collectionInput({
      fields: [field({ id: "f-count", key: "count", label: "Count", type: "number" })],
    }));

    await expect(
      cms.createItem(A, PROJECT, collection.id, { slug: "one", status: "draft", values: { "f-count": "12" } }),
    ).rejects.toMatchObject({ reason: "invalid-item" });
  });

  it("stamps publishedAt only when an item actually becomes published", async () => {
    const collection = await setup();
    const draft = await cms.createItem(A, PROJECT, collection.id, {
      slug: "one",
      status: "draft",
      values: { "f-title": "One" },
    });
    expect(draft.publishedAt).toBeUndefined();

    const published = await cms.updateItem(A, PROJECT, draft.id, {
      slug: "one",
      status: "published",
      values: { "f-title": "One" },
    });
    expect(published.publishedAt).toBeDefined();
  });

  it("refuses two items with the same slug in one collection", async () => {
    const collection = await setup();
    await cms.createItem(A, PROJECT, collection.id, { slug: "one", status: "draft", values: { "f-title": "One" } });

    await expect(
      cms.createItem(A, PROJECT, collection.id, { slug: "one", status: "draft", values: { "f-title": "Two" } }),
    ).rejects.toMatchObject({ reason: "slug-taken" });
  });

  it("allows the same slug in two different collections", async () => {
    const first = await setup();
    const second = await cms.createCollection(A, PROJECT, collectionInput({ name: "Notes", slug: "notes", fields: [field()] }));

    await cms.createItem(A, PROJECT, first.id, { slug: "about", status: "draft", values: { "f-title": "One" } });
    await expect(
      cms.createItem(A, PROJECT, second.id, { slug: "about", status: "draft", values: { "f-title": "Two" } }),
    ).resolves.toBeDefined();
  });

  it("duplicates as a draft, never as something publicly visible", async () => {
    const collection = await setup();
    const original = await cms.createItem(A, PROJECT, collection.id, {
      slug: "one",
      status: "published",
      values: { "f-title": "One" },
    });

    const copy = await cms.duplicateItem(A, PROJECT, original.id);
    expect(copy.status).toBe("draft");
    expect(copy.slug).toBe("one-copy");
    expect(copy.values).toEqual(original.values);
  });

  it("finds a free slug when a copy already exists", async () => {
    const collection = await setup();
    const original = await cms.createItem(A, PROJECT, collection.id, {
      slug: "one",
      status: "draft",
      values: { "f-title": "One" },
    });

    await cms.duplicateItem(A, PROJECT, original.id);
    expect((await cms.duplicateItem(A, PROJECT, original.id)).slug).toBe("one-copy-2");
  });

  it("returns only published items to the publication compiler", async () => {
    const collection = await setup();
    await cms.createItem(A, PROJECT, collection.id, { slug: "live", status: "published", values: { "f-title": "Live" } });
    await cms.createItem(A, PROJECT, collection.id, { slug: "wip", status: "draft", values: { "f-title": "Draft" } });

    expect((await cms.listPublished(PROJECT)).map((item) => item.slug)).toEqual(["live"]);
  });
});

describe("tenant isolation", () => {
  it("does not read, update or delete another workspace's item", async () => {
    const collection = await cms.createCollection(A, PROJECT, collectionInput());
    const item = await cms.createItem(A, PROJECT, collection.id, {
      slug: "one",
      status: "draft",
      values: { "f-title": "One" },
    });

    expect(await cms.findItem(B, PROJECT, item.id)).toBeNull();
    expect(await cms.deleteItem(B, PROJECT, item.id)).toBe(false);
    await expect(cms.updateItem(B, PROJECT, item.id, { slug: "one", status: "draft", values: {} })).rejects.toBeInstanceOf(
      CmsError,
    );

    expect(await cms.findItem(A, PROJECT, item.id)).not.toBeNull();
  });

  it("does not delete another workspace's collection", async () => {
    const collection = await cms.createCollection(A, PROJECT, collectionInput());
    expect(await cms.deleteCollection(B, PROJECT, collection.id)).toBe(false);
    expect(await cms.listCollections(A, PROJECT)).toHaveLength(1);
  });
});

describe("detail templates", () => {
  const setup = async () => cms.createCollection(A, PROJECT, collectionInput());

  it("has no template until one is saved", async () => {
    const collection = await setup();
    expect(await cms.findTemplate(A, PROJECT, collection.id)).toBeNull();
  });

  it("saving a draft does not change what visitors see", async () => {
    const collection = await setup();
    const template = await cms.saveTemplateDraft(A, PROJECT, collection.id, {
      draftSections: [{ id: "s1" }],
      seo: {},
    });

    expect(template.draftSections).toHaveLength(1);
    expect(template.publishedSections).toBeUndefined();
    expect(template.publishedAt).toBeUndefined();
  });

  it("publishing copies the draft over the live copy", async () => {
    const collection = await setup();
    await cms.saveTemplateDraft(A, PROJECT, collection.id, { draftSections: [{ id: "s1" }], seo: {} });

    const published = await cms.publishTemplate(A, PROJECT, collection.id);
    expect(published.publishedSections).toEqual([{ id: "s1" }]);
    expect(published.publishedAt).toBeDefined();
  });

  it("a later draft edit leaves the live template alone until it is published again", async () => {
    const collection = await setup();
    await cms.saveTemplateDraft(A, PROJECT, collection.id, { draftSections: [{ id: "s1" }], seo: {} });
    await cms.publishTemplate(A, PROJECT, collection.id);

    const edited = await cms.saveTemplateDraft(A, PROJECT, collection.id, {
      draftSections: [{ id: "s1" }, { id: "s2" }],
      seo: {},
    });

    // One template renders every item, so an in-progress edit reaching visitors would change
    // hundreds of pages nobody approved.
    expect(edited.publishedSections).toEqual([{ id: "s1" }]);
  });

  it("keeps one template per collection however often it is saved", async () => {
    const collection = await setup();
    await cms.saveTemplateDraft(A, PROJECT, collection.id, { draftSections: [], seo: {} });
    await cms.saveTemplateDraft(A, PROJECT, collection.id, { draftSections: [{ id: "s1" }], seo: {} });

    expect(await cms.listTemplatesForProject(PROJECT)).toHaveLength(1);
  });

  it("removes the template when its collection is deleted", async () => {
    const collection = await setup();
    await cms.saveTemplateDraft(A, PROJECT, collection.id, { draftSections: [], seo: {} });

    await cms.deleteCollection(A, PROJECT, collection.id);
    expect(await cms.listTemplatesForProject(PROJECT)).toEqual([]);
  });

  it("does not read or publish another workspace's template", async () => {
    const collection = await setup();
    await cms.saveTemplateDraft(A, PROJECT, collection.id, { draftSections: [{ id: "s1" }], seo: {} });

    expect(await cms.findTemplate(B, PROJECT, collection.id)).toBeNull();
    await expect(cms.publishTemplate(B, PROJECT, collection.id)).rejects.toBeInstanceOf(CmsError);
  });
});
