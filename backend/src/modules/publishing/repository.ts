import {
  contentHash,
  isDomainLive,
  platformHostname,
  resolveHost,
  type PublishedRedirect,
  type PublishedSiteVersion,
  type RouteManifestEntry,
  type SiteDomain,
} from "@websitebuilder/shared";
import { ObjectId, type Collection, type Db } from "mongodb";

import type { WorkspaceContext } from "../projects/repository";

/**
 * Published versions and site domains.
 *
 * Two invariants hold the whole publishing story together:
 *
 * 1. A version is written once and never updated. Rollback points at an older one rather than
 *    rewriting anything, so it cannot fail halfway and leave a half-restored site.
 * 2. Live traffic follows a single pointer on the project. The snapshot is written and verified
 *    first, and only then does the pointer move — a failed build cannot touch a running site.
 */
export const PUBLISHING_COLLECTIONS = { versions: "publishedSiteVersions", domains: "siteDomains" } as const;

type VersionDocument = Omit<PublishedSiteVersion, "id"> & { _id: ObjectId };
type DomainDocument = Omit<SiteDomain, "id"> & { _id: ObjectId };

export class PublishError extends Error {
  constructor(public readonly reason: "revision-changed" | "hash-mismatch" | "not-found" | "hostname-taken") {
    super(reason);
    this.name = "PublishError";
  }
}

export async function ensurePublishingIndexes(db: Db): Promise<void> {
  await db.collection(PUBLISHING_COLLECTIONS.versions).createIndexes([
    { key: { projectId: 1, version: 1 }, name: "project_version_unique", unique: true },
    { key: { projectId: 1, createdAt: -1 }, name: "history" },
  ]);
  await db.collection(PUBLISHING_COLLECTIONS.domains).createIndexes([
    // Global uniqueness: two projects claiming one hostname is how a customer's domain serves
    // someone else's site.
    { key: { hostname: 1 }, name: "hostname_unique", unique: true },
    { key: { workspaceId: 1, projectId: 1, status: 1 }, name: "project_domains" },
  ]);
}

export class PublishingRepository {
  private readonly versions: Collection<VersionDocument>;
  private readonly domains: Collection<DomainDocument>;

  constructor(
    db: Db,
    private readonly projects: Collection<{ _id: ObjectId; workspaceId: string; activePublishedVersionId?: string; revision: number }>,
  ) {
    this.versions = db.collection<VersionDocument>(PUBLISHING_COLLECTIONS.versions);
    this.domains = db.collection<DomainDocument>(PUBLISHING_COLLECTIONS.domains);
  }

  /**
   * Writes an immutable version and activates it.
   *
   * The order is deliberate: insert, verify the stored hash, then compare-and-swap the pointer with
   * the source revision. If the project moved on while the snapshot was compiling, the swap fails
   * and the stored version is simply never activated — it becomes an orphan, which is harmless,
   * rather than publishing a snapshot of stale content.
   */
  async publish(
    context: WorkspaceContext,
    projectId: string,
    input: {
      sourceRevision: number;
      schemaVersion: number;
      document: unknown;
      routes: RouteManifestEntry[];
      redirects: PublishedRedirect[];
      referencedMediaIds: string[];
      /** Content identity from the compiler. Recomputing it here would use a different input. */
      contentHash: string;
    },
  ): Promise<PublishedSiteVersion> {
    if (!ObjectId.isValid(projectId) || projectId.length !== 24) throw new PublishError("not-found");

    // Integrity, not identity: this hash exists only to prove the stored document is the one that
    // was sent. The compiler's contentHash answers the different question of whether the site
    // changed, and is stored as given.
    const writtenHash = contentHash(input);
    const nextVersion = (await this.latestVersionNumber(projectId)) + 1;
    const now = new Date().toISOString();

    const document: Omit<VersionDocument, "_id"> = {
      workspaceId: context.workspaceId,
      projectId,
      version: nextVersion,
      sourceRevision: input.sourceRevision,
      schemaVersion: input.schemaVersion,
      document: input.document,
      routes: input.routes,
      redirects: input.redirects,
      referencedMediaIds: input.referencedMediaIds,
      contentHash: input.contentHash,
      createdByUserId: context.userId,
      createdAt: now,
    };

    const inserted = await this.versions.insertOne(document as VersionDocument);

    // Read it back: a snapshot that did not survive the write must never become live.
    const stored = await this.versions.findOne({ _id: inserted.insertedId });
    if (stored === null || contentHash(stored) !== writtenHash) throw new PublishError("hash-mismatch");

    const swapped = await this.projects.updateOne(
      { _id: new ObjectId(projectId), workspaceId: context.workspaceId, revision: input.sourceRevision },
      { $set: { activePublishedVersionId: inserted.insertedId.toHexString() } },
    );
    if (swapped.matchedCount === 0) throw new PublishError("revision-changed");

    return toVersion(stored);
  }

  /**
   * Points the project at an earlier version.
   *
   * Nothing is rewritten and no draft is touched, so rollback is a single atomic write that either
   * happens or does not.
   */
  async rollback(context: WorkspaceContext, projectId: string, versionId: string): Promise<PublishedSiteVersion> {
    if (!ObjectId.isValid(projectId) || !ObjectId.isValid(versionId)) throw new PublishError("not-found");

    const version = await this.versions.findOne({
      _id: new ObjectId(versionId),
      workspaceId: context.workspaceId,
      projectId,
    });
    if (version === null) throw new PublishError("not-found");

    const updated = await this.projects.updateOne(
      { _id: new ObjectId(projectId), workspaceId: context.workspaceId },
      { $set: { activePublishedVersionId: versionId } },
    );
    if (updated.matchedCount === 0) throw new PublishError("not-found");

    return toVersion(version);
  }

  async findActive(projectId: string, activeVersionId: string | undefined): Promise<PublishedSiteVersion | null> {
    if (activeVersionId === undefined || !ObjectId.isValid(activeVersionId)) return null;
    const version = await this.versions.findOne({ _id: new ObjectId(activeVersionId), projectId });
    return version === null ? null : toVersion(version);
  }

  /** The version a project is serving right now, resolved from the project's own pointer. */
  async findActiveForProject(projectId: string): Promise<PublishedSiteVersion | null> {
    const versionId = await this.findActiveVersionId(projectId);
    return versionId === null ? null : this.findActive(projectId, versionId);
  }

  /**
   * Just the pointer.
   *
   * The renderer reads this on every request because it is the one value a publish or a rollback
   * moves, and it runs in a different process from the API that moves it. Reading only the pointer
   * keeps that fresh without loading the snapshot it names.
   */
  async findActiveVersionId(projectId: string): Promise<string | null> {
    if (!ObjectId.isValid(projectId) || projectId.length !== 24) return null;
    const project = await this.projects.findOne(
      { _id: new ObjectId(projectId) },
      { projection: { activePublishedVersionId: 1 } },
    );
    return project?.activePublishedVersionId ?? null;
  }

  async history(
    context: WorkspaceContext,
    projectId: string,
    options: { limit?: number } = {},
  ): Promise<PublishedSiteVersion[]> {
    const documents = await this.versions
      .find(
        { workspaceId: context.workspaceId, projectId },
        // The stored document is large and history only needs the summary.
        { projection: { document: 0 }, sort: { version: -1 }, limit: Math.min(100, options.limit ?? 20) },
      )
      .toArray();
    return documents.map(toVersion);
  }

  /**
   * Removes old versions beyond the retention count, never the active one.
   *
   * Deleting the version a site is currently serving would take it offline to save disk.
   *
   * Returns the ids it removed rather than a count, because a version is not the only thing that
   * describes a layout: analytics stores click and attention coordinates against it, and those
   * coordinates cannot be drawn once the layout is gone. The caller is what connects the two.
   */
  async pruneVersions(
    context: WorkspaceContext,
    projectId: string,
    keep: number,
    activeVersionId: string | undefined,
  ): Promise<string[]> {
    const all = await this.versions
      .find({ workspaceId: context.workspaceId, projectId }, { projection: { _id: 1, version: 1 }, sort: { version: -1 } })
      .toArray();

    const removable = all
      .slice(keep)
      .filter((version) => version._id.toHexString() !== activeVersionId)
      .map((version) => version._id);
    if (removable.length === 0) return [];

    // Scoped by `_id` alone, which is safe because the ids came from a workspace-scoped query — but
    // the scope is repeated so that stays true if the query above ever changes.
    await this.versions.deleteMany({ workspaceId: context.workspaceId, projectId, _id: { $in: removable } });
    return removable.map((id) => id.toHexString());
  }

  /** Every project gets exactly one platform hostname, created idempotently. */
  async ensurePlatformDomain(
    context: WorkspaceContext,
    projectId: string,
    projectSlug: string,
    rootDomain: string,
    extraReserved: readonly string[] = [],
  ): Promise<SiteDomain | null> {
    const hostname = platformHostname(projectSlug, rootDomain, extraReserved);
    if (hostname === null) return null;

    const existing = await this.domains.findOne({ hostname });
    if (existing !== null) {
      // A hostname already owned by another project must never be reassigned.
      if (existing.projectId !== projectId) throw new PublishError("hostname-taken");
      return toDomain(existing);
    }

    // Primary only when the project has none yet.
    //
    // A project can end up with more than one platform hostname — the root domain changes, or a
    // customer connects their own domain and makes it canonical. Marking every new one primary
    // would leave two rows claiming it, and the address the dashboard shows would then depend on
    // which one the query happened to return first.
    const hasPrimary = await this.domains.countDocuments(
      { workspaceId: context.workspaceId, projectId, isPrimary: true },
      { limit: 1 },
    );

    const now = new Date().toISOString();
    const document: Omit<DomainDocument, "_id"> = {
      workspaceId: context.workspaceId,
      projectId,
      hostname,
      kind: "platform",
      status: "active",
      isPrimary: hasPrimary === 0,
      provider: "platform_wildcard",
      sslStatus: "active",
      createdAt: now,
      verifiedAt: now,
    };

    const inserted = await this.domains.insertOne(document as DomainDocument);
    return toDomain({ ...document, _id: inserted.insertedId } as DomainDocument);
  }

  async listDomains(context: WorkspaceContext, projectId: string): Promise<SiteDomain[]> {
    const documents = await this.domains
      .find({ workspaceId: context.workspaceId, projectId }, { sort: { createdAt: 1 } })
      .toArray();
    return documents.map(toDomain);
  }

  /** Public host lookup. Only live domains resolve, and identity comes from the hostname alone. */
  async resolvePublicHost(rawHostname: string): Promise<{ projectId: string; domain: SiteDomain } | null> {
    const documents = await this.domains.find({ status: "active" }).toArray();
    return resolveHost(rawHostname, documents.map(toDomain));
  }

  async setPrimaryDomain(context: WorkspaceContext, projectId: string, domainId: string): Promise<SiteDomain | null> {
    if (!ObjectId.isValid(domainId) || domainId.length !== 24) return null;

    const target = await this.domains.findOne({
      _id: new ObjectId(domainId),
      workspaceId: context.workspaceId,
      projectId,
    });
    // Only a live hostname may become canonical: pointing canonical URLs at a pending domain
    // would advertise a site that does not answer.
    if (target === null || !isDomainLive(toDomain(target))) return null;

    await this.domains.updateMany({ workspaceId: context.workspaceId, projectId }, { $set: { isPrimary: false } });
    await this.domains.updateOne({ _id: target._id }, { $set: { isPrimary: true } });

    return { ...toDomain(target), isPrimary: true };
  }

  private async latestVersionNumber(projectId: string): Promise<number> {
    const latest = await this.versions.findOne({ projectId }, { projection: { version: 1 }, sort: { version: -1 } });
    return latest?.version ?? 0;
  }
}

function toVersion(document: VersionDocument): PublishedSiteVersion {
  const { _id, ...rest } = document;
  return { ...rest, id: _id.toHexString() };
}

function toDomain(document: DomainDocument): SiteDomain {
  const { _id, ...rest } = document;
  return { ...rest, id: _id.toHexString() };
}
