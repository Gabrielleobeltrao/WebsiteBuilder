import {
  analyseSchemaChange,
  blocksSchemaChange,
  normalizeCollectionSlug,
  normalizePageSlug,
  validateCmsItem,
  type CmsCollectionInput,
  type CmsField,
  type CmsItemInput,
  type CmsItemStatus,
  type CmsValidationError,
  type SchemaChangeIssue,
} from "@websitebuilder/shared";
import { ObjectId, type Collection, type Db } from "mongodb";

import type { WorkspaceContext } from "../projects/repository";

/**
 * CMS collections and their items.
 *
 * Two rules shape everything here. Values are keyed by immutable field ids, so renaming a label
 * never touches stored data. And a value whose field was removed is kept rather than deleted: the
 * schema is an editing decision, and silently discarding content because someone reordered a form
 * is not recoverable.
 */
export const CMS_COLLECTIONS = { collections: "cmsCollections", items: "cmsItems" } as const;

export type CmsCollection = CmsCollectionInput & {
  id: string;
  workspaceId: string;
  projectId: string;
  /** A collection without a detail route holds data used by list elements only. */
  hasDetailRoute: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CmsItem = CmsItemInput & {
  id: string;
  workspaceId: string;
  projectId: string;
  collectionId: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

type CollectionDocument = Omit<CmsCollection, "id"> & { _id: ObjectId };
type ItemDocument = Omit<CmsItem, "id"> & { _id: ObjectId };

export class CmsError extends Error {
  constructor(
    public readonly reason: "not-found" | "slug-taken" | "schema-change-blocked" | "invalid-item",
    public readonly issues: SchemaChangeIssue[] | CmsValidationError[] = [],
  ) {
    super(reason);
    this.name = "CmsError";
  }
}

export async function ensureCmsIndexes(db: Db): Promise<void> {
  await db.collection(CMS_COLLECTIONS.collections).createIndexes([
    { key: { projectId: 1, slug: 1 }, name: "project_slug_unique", unique: true },
    { key: { workspaceId: 1, projectId: 1 }, name: "project_collections" },
  ]);
  await db.collection(CMS_COLLECTIONS.items).createIndexes([
    // Unique within a collection, not globally: two collections may each have an item called
    // "about" without colliding, because their public paths differ by collection slug.
    { key: { collectionId: 1, slug: 1 }, name: "collection_slug_unique", unique: true },
    { key: { projectId: 1, collectionId: 1, status: 1, updatedAt: -1 }, name: "listing" },
  ]);
}

export class CmsRepository {
  private readonly collections: Collection<CollectionDocument>;
  private readonly items: Collection<ItemDocument>;

  constructor(db: Db) {
    this.collections = db.collection<CollectionDocument>(CMS_COLLECTIONS.collections);
    this.items = db.collection<ItemDocument>(CMS_COLLECTIONS.items);
  }

  async listCollections(context: WorkspaceContext, projectId: string): Promise<CmsCollection[]> {
    const documents = await this.collections
      .find({ workspaceId: context.workspaceId, projectId }, { sort: { name: 1 } })
      .toArray();
    return documents.map(toCollection);
  }

  async findCollection(
    context: WorkspaceContext,
    projectId: string,
    collectionId: string,
  ): Promise<CmsCollection | null> {
    if (!ObjectId.isValid(collectionId) || collectionId.length !== 24) return null;
    const document = await this.collections.findOne({
      _id: new ObjectId(collectionId),
      workspaceId: context.workspaceId,
      projectId,
    });
    return document === null ? null : toCollection(document);
  }

  async createCollection(
    context: WorkspaceContext,
    projectId: string,
    input: CmsCollectionInput & { hasDetailRoute?: boolean },
  ): Promise<CmsCollection> {
    const slug = normalizeCollectionSlug(input.slug || input.name);
    const now = new Date().toISOString();

    const document: Omit<CollectionDocument, "_id"> = {
      workspaceId: context.workspaceId,
      projectId,
      name: input.name,
      slug,
      fields: input.fields,
      hasDetailRoute: input.hasDetailRoute ?? true,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const inserted = await this.collections.insertOne(document as CollectionDocument);
      return { ...document, id: inserted.insertedId.toHexString() };
    } catch (error) {
      if (isDuplicateKey(error)) throw new CmsError("slug-taken");
      throw error;
    }
  }

  /**
   * Applies a schema change after checking what it would do to existing items.
   *
   * A change that would invalidate published content is refused rather than applied with a warning:
   * the items are already public, and there is no moment at which a site should be serving content
   * its own schema rejects.
   */
  async updateCollection(
    context: WorkspaceContext,
    projectId: string,
    collectionId: string,
    input: CmsCollectionInput & { hasDetailRoute?: boolean },
  ): Promise<{ collection: CmsCollection; issues: SchemaChangeIssue[] }> {
    const existing = await this.findCollection(context, projectId, collectionId);
    if (existing === null) throw new CmsError("not-found");

    // Only published items are considered: a draft that a schema change invalidates is still being
    // written, and blocking on it would stop a designer mid-edit.
    const published = await this.items.find({ collectionId, status: "published" }).toArray();
    const issues = analyseSchemaChange({
      previous: existing.fields,
      next: input.fields,
      publishedItems: published.map((item) => ({ id: item._id.toHexString(), values: item.values })),
    });

    const blocking = issues.filter(blocksSchemaChange);
    if (blocking.length > 0) throw new CmsError("schema-change-blocked", blocking);

    const now = new Date().toISOString();
    await this.collections.updateOne(
      { _id: new ObjectId(collectionId) },
      {
        $set: {
          name: input.name,
          slug: normalizeCollectionSlug(input.slug || input.name),
          fields: input.fields,
          ...(input.hasDetailRoute === undefined ? {} : { hasDetailRoute: input.hasDetailRoute }),
          updatedAt: now,
        },
      },
    );

    // Values for removed fields stay on their items. They are invisible until the field returns,
    // and deleting them would make an accidental removal unrecoverable.
    const updated = await this.findCollection(context, projectId, collectionId);
    return { collection: updated!, issues };
  }

  /** Deleting a collection deletes its items; both are the same content from a user's view. */
  async deleteCollection(context: WorkspaceContext, projectId: string, collectionId: string): Promise<boolean> {
    const existing = await this.findCollection(context, projectId, collectionId);
    if (existing === null) return false;

    await this.items.deleteMany({ collectionId, workspaceId: context.workspaceId });
    await this.collections.deleteOne({ _id: new ObjectId(collectionId) });
    return true;
  }

  async listItems(
    context: WorkspaceContext,
    projectId: string,
    collectionId: string,
    filter: { status?: CmsItemStatus; search?: string; page?: number; perPage?: number } = {},
  ): Promise<{ items: CmsItem[]; total: number; page: number; perPage: number }> {
    const page = Math.max(1, filter.page ?? 1);
    const perPage = Math.min(100, Math.max(1, filter.perPage ?? 25));

    const query: Record<string, unknown> = { workspaceId: context.workspaceId, projectId, collectionId };
    if (filter.status !== undefined) query.status = filter.status;
    if (filter.search !== undefined && filter.search.trim().length > 0) {
      // Matches the slug only. Searching arbitrary values would need every field's text indexed,
      // and a half-working search is worse than an obvious one.
      query.slug = { $regex: escapeRegex(filter.search.trim().toLowerCase()) };
    }

    const [items, total] = await Promise.all([
      this.items
        .find(query, { sort: { updatedAt: -1 }, skip: (page - 1) * perPage, limit: perPage })
        .toArray(),
      this.items.countDocuments(query),
    ]);

    return { items: items.map(toItem), total, page, perPage };
  }

  async findItem(context: WorkspaceContext, projectId: string, itemId: string): Promise<CmsItem | null> {
    if (!ObjectId.isValid(itemId) || itemId.length !== 24) return null;
    const document = await this.items.findOne({
      _id: new ObjectId(itemId),
      workspaceId: context.workspaceId,
      projectId,
    });
    return document === null ? null : toItem(document);
  }

  async createItem(
    context: WorkspaceContext,
    projectId: string,
    collectionId: string,
    input: CmsItemInput,
  ): Promise<CmsItem> {
    const collection = await this.findCollection(context, projectId, collectionId);
    if (collection === null) throw new CmsError("not-found");

    const errors = await this.validate(collection.fields, projectId, input);
    if (errors.length > 0) throw new CmsError("invalid-item", errors);

    const now = new Date().toISOString();
    const document: Omit<ItemDocument, "_id"> = {
      workspaceId: context.workspaceId,
      projectId,
      collectionId,
      slug: normalizePageSlug(input.slug || String(input.values.title ?? "item")),
      status: input.status,
      values: input.values,
      ...(input.status === "published" ? { publishedAt: input.publishedAt ?? now } : {}),
      createdByUserId: context.userId,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const inserted = await this.items.insertOne(document as ItemDocument);
      return { ...document, id: inserted.insertedId.toHexString() };
    } catch (error) {
      if (isDuplicateKey(error)) throw new CmsError("slug-taken");
      throw error;
    }
  }

  async updateItem(
    context: WorkspaceContext,
    projectId: string,
    itemId: string,
    input: CmsItemInput,
  ): Promise<CmsItem> {
    const existing = await this.findItem(context, projectId, itemId);
    if (existing === null) throw new CmsError("not-found");

    const collection = await this.findCollection(context, projectId, existing.collectionId);
    if (collection === null) throw new CmsError("not-found");

    const errors = await this.validate(collection.fields, projectId, input);
    if (errors.length > 0) throw new CmsError("invalid-item", errors);

    const now = new Date().toISOString();
    // Values for fields the schema no longer declares are preserved: the incoming payload only
    // carries current fields, and dropping the rest would delete content on every ordinary save.
    const values = { ...existing.values, ...input.values };

    try {
      await this.items.updateOne(
        { _id: new ObjectId(itemId) },
        {
          $set: {
            slug: normalizePageSlug(input.slug || existing.slug),
            status: input.status,
            values,
            updatedAt: now,
            ...(input.status === "published" && existing.status !== "published"
              ? { publishedAt: now }
              : {}),
          },
        },
      );
    } catch (error) {
      if (isDuplicateKey(error)) throw new CmsError("slug-taken");
      throw error;
    }

    return (await this.findItem(context, projectId, itemId))!;
  }

  /** Copies an item as a draft. A duplicate must never appear publicly by itself. */
  async duplicateItem(context: WorkspaceContext, projectId: string, itemId: string): Promise<CmsItem> {
    const existing = await this.findItem(context, projectId, itemId);
    if (existing === null) throw new CmsError("not-found");

    for (let attempt = 1; attempt <= 20; attempt += 1) {
      try {
        return await this.createItem(context, projectId, existing.collectionId, {
          slug: `${existing.slug}-copy${attempt === 1 ? "" : `-${attempt}`}`,
          status: "draft",
          values: existing.values,
        });
      } catch (error) {
        if (error instanceof CmsError && error.reason === "slug-taken") continue;
        throw error;
      }
    }

    throw new CmsError("slug-taken");
  }

  async deleteItem(context: WorkspaceContext, projectId: string, itemId: string): Promise<boolean> {
    if (!ObjectId.isValid(itemId) || itemId.length !== 24) return false;
    const result = await this.items.deleteOne({
      _id: new ObjectId(itemId),
      workspaceId: context.workspaceId,
      projectId,
    });
    return result.deletedCount === 1;
  }

  /** Published items only, for the publication compiler and the public renderer. */
  async listPublished(projectId: string, collectionId?: string): Promise<CmsItem[]> {
    const query: Record<string, unknown> = { projectId, status: "published" };
    if (collectionId !== undefined) query.collectionId = collectionId;

    const documents = await this.items.find(query, { sort: { publishedAt: -1 } }).toArray();
    return documents.map(toItem);
  }

  private async validate(
    fields: readonly CmsField[],
    projectId: string,
    input: CmsItemInput,
  ): Promise<CmsValidationError[]> {
    // Reference targets are checked against this project's own collections, so an id copied from
    // elsewhere cannot pull another tenant's content into a page.
    const collections = await this.collections.find({ projectId }, { projection: { _id: 1 } }).toArray();
    const known = new Set(collections.map((collection) => collection._id.toHexString()));

    const { errors } = validateCmsItem({ fields: [...fields] }, input.values, {
      collectionExistsInProject: (collectionId) => known.has(collectionId),
    });
    return errors;
  }
}

function toCollection(document: CollectionDocument): CmsCollection {
  const { _id, ...rest } = document;
  return { ...rest, id: _id.toHexString() };
}

function toItem(document: ItemDocument): CmsItem {
  const { _id, ...rest } = document;
  return { ...rest, id: _id.toHexString() };
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: number }).code === 11_000;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
