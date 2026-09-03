import { randomUUID } from "node:crypto";
import {
  createProjectDocument,
  diagnoseStoredProject,
  isSafeToOverwrite,
  normalizeProjectSlug,
  type DocumentDiagnosis,
  type BuilderDocumentInput,
  type BuilderProject,
  type ProjectSummary,
} from "@websitebuilder/shared";
import { ObjectId, type Collection, type Db } from "mongodb";

import { COLLECTIONS } from "../../db/indexes";
import { PUBLISHING_COLLECTIONS } from "../publishing/repository";

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

/**
 * A stored document this build must not act on.
 *
 * Raised instead of overwriting or publishing: a record written by a newer deployment is somebody
 * else's work, and one that no longer parses is a document whose contents nobody can vouch for.
 * Both used to pass straight through, because reads were trusted while writes were validated.
 */
export class UnsupportedDocumentError extends Error {
  constructor(
    public readonly diagnosis: DocumentDiagnosis,
  ) {
    super(
      diagnosis.status === "future"
        ? "This site was saved by a newer version of the builder and cannot be changed here."
        : "This site's saved content could not be read.",
    );
    this.name = "UnsupportedDocumentError";
  }
}

export class ProjectRepository {
  private readonly collection: Collection<ProjectDocument>;

  constructor(private readonly db: Db) {
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
        projection: {
          name: 1,
          slug: 1,
          clientId: 1,
          revision: 1,
          createdAt: 1,
          updatedAt: 1,
          activePublishedVersionId: 1,
          pageCount: { $size: "$pages" },
        },
        sort: { updatedAt: -1 },
        limit: 200,
      })
      .toArray();

    // One query for the whole page rather than one per site: a listing that asks the database a
    // question per row gets slower with every site a customer adds, which is exactly backwards.
    const serving = documents.filter((document) => Boolean((document as { activePublishedVersionId?: string }).activePublishedVersionId));
    const hostnames = await this.primaryHostnames(
      context,
      serving.map((document) => (document as { _id: ObjectId })._id.toHexString()),
    );

    return documents.map((document) => {
      const { _id, pageCount, ...rest } = document as ProjectDocument & { pageCount: number };
      const projectId = _id.toHexString();
      const hostname = hostnames.get(projectId);
      // Both facts are required. A published site with no live address, and a live address on a
      // site that was never published, are each a link to nothing.
      const isPublished = (rest as { activePublishedVersionId?: string }).activePublishedVersionId !== undefined;
      const live = isPublished && hostname !== undefined;

      return {
        id: projectId,
        name: rest.name,
        slug: rest.slug,
        ...(rest.clientId ? { clientId: rest.clientId } : {}),
        pageCount,
        revision: rest.revision,
        createdAt: rest.createdAt,
        updatedAt: rest.updatedAt,
        isPublished,
        ...(live ? { liveUrl: `https://${hostname}` } : {}),
      };
    });
  }

  /**
   * The live hostname of each project that has one, scoped to this workspace.
   *
   * Only a primary hostname that is active counts. A pending one is an address the platform is
   * still arranging, and a customer told to open it would find nothing there.
   */
  private async primaryHostnames(context: WorkspaceContext, projectIds: string[]): Promise<Map<string, string>> {
    if (projectIds.length === 0) return new Map();

    const domains = await this.db
      .collection<{ projectId: string; hostname: string }>(PUBLISHING_COLLECTIONS.domains)
      .find(
        { workspaceId: context.workspaceId, projectId: { $in: projectIds }, isPrimary: true, status: "active" },
        { projection: { projectId: 1, hostname: 1 } },
      )
      .toArray();

    return new Map(domains.map((domain) => [domain.projectId, domain.hostname]));
  }

  async findById(context: WorkspaceContext, projectId: string): Promise<BuilderProject | null> {
    const diagnosed = await this.diagnose(context, projectId);
    return diagnosed === null ? null : diagnosed.document;
  }

  /**
   * The record, and what this build makes of it.
   *
   * One read, one parse, one answer — the boundary every other read goes through. Workspace-scoped
   * first, as every business query is: a project id from a URL can only narrow a set already
   * confined to the caller's tenant.
   */
  async diagnose(context: WorkspaceContext, projectId: string): Promise<DocumentDiagnosis | null> {
    const _id = toObjectId(projectId);
    if (_id === null) return null;

    const document = await this.collection.findOne({ _id, workspaceId: context.workspaceId });
    if (document === null) return null;

    return diagnoseStoredProject(toProject(document));
  }

  /**
   * Creates a project, choosing a free slug for it.
   *
   * Allocating a slug is a read followed by a write, and the unique index is what settles a tie. Two
   * people creating "Portfolio" in the same instant both saw the same slug free, and the loser got
   * an error instead of a site — for a name collision the product is perfectly able to resolve on
   * their behalf, and had already resolved for everyone who was not unlucky with timing.
   *
   * So a duplicate key is treated as what it is: somebody took that slug between the look and the
   * write. Look again. Bounded, because a genuine wall of contention should surface rather than
   * spin, and `SlugTakenError` still exists for the caller who exhausts it.
   */
  async create(
    context: WorkspaceContext,
    input: { name: string; clientId?: string },
    now = new Date().toISOString(),
  ): Promise<BuilderProject> {
    let lastSlug = "";

    for (let attempt = 0; attempt < 5; attempt += 1) {
      /*
       * The tidy slug is contested once, then abandoned.
       *
       * Re-running the scan after a collision walks the same candidates in the same order, so every
       * loser of one race enters the next one against the same rivals. A discriminator settles it in
       * a single further attempt however many are creating "Portfolio" at that instant, and only the
       * ones who actually collided pay for it — the first caller still gets the readable slug.
       */
      const slug = attempt === 0 ? await this.allocateSlug(input.name) : await this.discriminatedSlug(input.name);
      lastSlug = slug;
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
        if (!isDuplicateKey(error)) throw error;
      }
    }

    throw new SlugTakenError(lastSlug);
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

    /*
     * What is already there decides whether this write may happen.
     *
     * A revision match proves the client read the same generation; it says nothing about whether
     * this build understands what it is replacing. A newer deployment's document overwritten here is
     * work destroyed, and the person who did it would see a successful save.
     */
    const existing = await this.diagnose(context, projectId);
    if (existing !== null && !isSafeToOverwrite(existing)) throw new UnsupportedDocumentError(existing);

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
  /** The base slug with a short random discriminator, for a caller that just lost a race for it. */
  private async discriminatedSlug(name: string): Promise<string> {
    const base = (normalizeProjectSlug(name) || "site").slice(0, 54).replace(/-+$/, "");
    return `${base}-${randomUUID().slice(0, 8)}`;
  }

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
