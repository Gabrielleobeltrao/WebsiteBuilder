import {
  createProjectDocument,
  normalizeProjectSlug,
  type BuilderDocumentInput,
  type BuilderProject,
  type ProjectSummary,
} from "@websitebuilder/shared";
import { ObjectId, type Collection, type Db } from "mongodb";

import { COLLECTIONS } from "../../db/indexes";

/**
 * Stored shape. `_id` is the MongoDB identity; the API exposes it as `id`. `workspaceId` is
 * required on every document — that is the invariant the whole tenancy model rests on.
 */
type ProjectDocument = Omit<BuilderProject, "id"> & { _id: ObjectId };

export class RevisionConflictError extends Error {
  constructor(public readonly currentRevision: number) {
    super("Document was modified after it was loaded");
    this.name = "RevisionConflictError";
  }
}

export class SlugTakenError extends Error {
  constructor(public readonly slug: string) {
    super(`Slug ${slug} is already in use`);
    this.name = "SlugTakenError";
  }
}

/**
 * Verified tenant context. Every method takes one: there is deliberately no overload that reads a
 * project by ID alone, because that is the shape a cross-tenant bug takes.
 */
export type WorkspaceContext = { workspaceId: string; userId: string };

function toProject(document: ProjectDocument): BuilderProject {
  const { _id, ...rest } = document;
  return { ...rest, id: _id.toHexString() };
}

function toObjectId(id: string): ObjectId | null {
  return ObjectId.isValid(id) && id.length === 24 ? new ObjectId(id) : null;
}

export class ProjectRepository {
  private readonly collection: Collection<ProjectDocument>;

  constructor(db: Db) {
    this.collection = db.collection<ProjectDocument>(COLLECTIONS.projects);
  }

  async listSummaries(context: WorkspaceContext, filter: { clientId?: string } = {}): Promise<ProjectSummary[]> {
    const query = {
      workspaceId: context.workspaceId,
      ...(filter.clientId ? { clientId: filter.clientId } : {}),
    };
    // Pages are projected away: a listing must never pay the cost of whole builder documents.
    const documents = await this.collection
      .find(query, {
        projection: { name: 1, slug: 1, clientId: 1, revision: 1, createdAt: 1, updatedAt: 1, pageCount: { $size: "$pages" } },
        sort: { updatedAt: -1 },
        limit: 200,
      })
      .toArray();

    return documents.map((document) => {
      const { _id, pageCount, ...rest } = document as ProjectDocument & { pageCount: number };
      return {
        id: _id.toHexString(),
        name: rest.name,
        slug: rest.slug,
        ...(rest.clientId ? { clientId: rest.clientId } : {}),
        pageCount,
        revision: rest.revision,
        createdAt: rest.createdAt,
        updatedAt: rest.updatedAt,
      };
    });
  }

  async findById(context: WorkspaceContext, projectId: string): Promise<BuilderProject | null> {
    const _id = toObjectId(projectId);
    if (_id === null) return null;
    const document = await this.collection.findOne({ _id, workspaceId: context.workspaceId });
    return document === null ? null : toProject(document);
  }

  async create(
    context: WorkspaceContext,
    input: { name: string; clientId?: string },
    now = new Date().toISOString(),
  ): Promise<BuilderProject> {
    const slug = await this.allocateSlug(input.name);
    const document = createProjectDocument({ name: input.name, slug });

    const toInsert = {
      ...document,
      workspaceId: context.workspaceId,
      createdByUserId: context.userId,
      ...(input.clientId ? { clientId: input.clientId } : {}),
      revision: 1,
      createdAt: now,
      updatedAt: now,
    } as Omit<ProjectDocument, "_id">;

    try {
      const result = await this.collection.insertOne(toInsert as ProjectDocument);
      return toProject({ ...toInsert, _id: result.insertedId } as ProjectDocument);
    } catch (error) {
      if (isDuplicateKey(error)) throw new SlugTakenError(slug);
      throw error;
    }
  }

  async rename(context: WorkspaceContext, projectId: string, name: string): Promise<BuilderProject | null> {
    const _id = toObjectId(projectId);
    if (_id === null) return null;
    const document = await this.collection.findOneAndUpdate(
      { _id, workspaceId: context.workspaceId },
      { $set: { name, updatedAt: new Date().toISOString() }, $inc: { revision: 1 } },
      { returnDocument: "after" },
    );
    return document === null ? null : toProject(document);
  }

  /**
   * Saves a complete builder document. The update matches on the caller's `revision`, so two
   * concurrent saves cannot silently overwrite one another: the loser gets the current revision
   * back and the client decides what to do.
   */
  async saveDocument(
    context: WorkspaceContext,
    projectId: string,
    expectedRevision: number,
    document: BuilderDocumentInput,
  ): Promise<BuilderProject> {
    const _id = toObjectId(projectId);
    if (_id === null) throw new RevisionConflictError(expectedRevision);

    const updated = await this.collection.findOneAndUpdate(
      { _id, workspaceId: context.workspaceId, revision: expectedRevision },
      {
        $set: {
          schemaVersion: document.schemaVersion,
          name: document.name,
          slug: document.slug,
          breakpoints: document.breakpoints,
          pages: document.pages,
          sharedSections: document.sharedSections,
          seo: document.seo,
          featureStates: document.featureStates,
          updatedAt: new Date().toISOString(),
        },
        $inc: { revision: 1 },
      },
      { returnDocument: "after" },
    );

    if (updated === null) {
      const current = await this.collection.findOne(
        { _id, workspaceId: context.workspaceId },
        { projection: { revision: 1 } },
      );
      if (current === null) throw new RevisionConflictError(expectedRevision);
      throw new RevisionConflictError(current.revision);
    }
    return toProject(updated);
  }

  async delete(context: WorkspaceContext, projectId: string): Promise<boolean> {
    const _id = toObjectId(projectId);
    if (_id === null) return false;
    const result = await this.collection.deleteOne({ _id, workspaceId: context.workspaceId });
    return result.deletedCount === 1;
  }

  /**
   * Project slugs become public hostnames, so they are unique across the whole platform. A
   * collision gets a numeric suffix rather than failing the user's first action.
   */
  private async allocateSlug(name: string): Promise<string> {
    const base = normalizeProjectSlug(name) || "site";
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`.slice(0, 63).replace(/-+$/, "");
      const existing = await this.collection.findOne({ slug: candidate }, { projection: { _id: 1 } });
      if (existing === null) return candidate;
    }
    throw new SlugTakenError(base);
  }
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}
