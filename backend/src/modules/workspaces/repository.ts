import { normalizeProjectSlug } from "@websitebuilder/shared";
import { ObjectId, type Collection, type Db } from "mongodb";

import { isWorkspaceRole, type WorkspaceRole } from "./permissions";

/**
 * Application-owned workspace records and membership lookups.
 *
 * Better Auth's Organization plugin owns the authoritative membership documents; this repository
 * reads them for authorisation and keeps the product's own profile fields beside them. Membership
 * is always read from the database, never inferred from the request.
 */

export const WORKSPACE_KINDS = ["personal", "agency", "business"] as const;
export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number];

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  kind: WorkspaceKind;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type Membership = { workspaceId: string; userId: string; role: WorkspaceRole };

type OrganizationDocument = {
  _id: ObjectId | string;
  name: string;
  slug: string;
  createdAt?: Date | string;
  metadata?: string | { kind?: string; createdByUserId?: string };
};

type MemberDocument = {
  _id: ObjectId | string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt?: Date | string;
};

function idToString(value: ObjectId | string): string {
  return typeof value === "string" ? value : value.toHexString();
}

function parseMetadata(metadata: OrganizationDocument["metadata"]): { kind: WorkspaceKind; createdByUserId: string } {
  const raw = typeof metadata === "string" ? safeParse(metadata) : (metadata ?? {});
  const kind = WORKSPACE_KINDS.includes(raw.kind as WorkspaceKind) ? (raw.kind as WorkspaceKind) : "personal";
  return { kind, createdByUserId: typeof raw.createdByUserId === "string" ? raw.createdByUserId : "" };
}

function safeParse(value: string): { kind?: string; createdByUserId?: string } {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? (parsed as { kind?: string }) : {};
  } catch {
    return {};
  }
}

export class WorkspaceRepository {
  private readonly organizations: Collection<OrganizationDocument>;
  private readonly members: Collection<MemberDocument>;

  constructor(db: Db) {
    // Collection names come from Better Auth's Organization plugin schema.
    this.organizations = db.collection<OrganizationDocument>("organization");
    this.members = db.collection<MemberDocument>("member");
  }

  /**
   * Resolves a user's role in a workspace, or null when they are not a member.
   *
   * This is the single gate every business request passes through. It reads membership from the
   * database rather than trusting an active-organization value the browser supplied, which is what
   * stops a stale or forged workspace ID from granting access.
   */
  async findMembership(workspaceId: string, userId: string): Promise<Membership | null> {
    const member = await this.members.findOne({ organizationId: workspaceId, userId });
    if (member === null) return null;
    if (!isWorkspaceRole(member.role)) return null;
    return { workspaceId, userId, role: member.role };
  }

  async listForUser(userId: string): Promise<Workspace[]> {
    const memberships = await this.members.find({ userId }, { projection: { organizationId: 1 } }).toArray();
    const ids = memberships.map((membership) => membership.organizationId);
    if (ids.length === 0) return [];

    const organizations = await this.organizations
      .find({ $or: [{ _id: { $in: ids } }, { _id: { $in: ids.filter(ObjectId.isValid).map((id) => new ObjectId(id)) } }] })
      .toArray();

    return organizations.map((organization) => this.toWorkspace(organization));
  }

  async findById(workspaceId: string): Promise<Workspace | null> {
    const organization = await this.organizations.findOne({
      $or: [{ _id: workspaceId }, ...(ObjectId.isValid(workspaceId) ? [{ _id: new ObjectId(workspaceId) }] : [])],
    });
    return organization === null ? null : this.toWorkspace(organization);
  }

  /**
   * Creates the user's personal workspace exactly once.
   *
   * Idempotent by design: signup can be retried, and a duplicate personal workspace would give one
   * person two disconnected homes with no way to merge them.
   */
  async ensurePersonalWorkspace(input: { userId: string; name: string }): Promise<Workspace> {
    const existing = await this.members.find({ userId: input.userId }).toArray();
    for (const membership of existing) {
      const workspace = await this.findById(membership.organizationId);
      if (workspace?.kind === "personal" && workspace.createdByUserId === input.userId) return workspace;
    }

    const now = new Date().toISOString();
    const slug = await this.allocateSlug(input.name);
    const organizationId = new ObjectId();

    await this.organizations.insertOne({
      _id: organizationId,
      name: input.name,
      slug,
      createdAt: now,
      metadata: JSON.stringify({ kind: "personal", createdByUserId: input.userId }),
    });
    await this.members.insertOne({
      _id: new ObjectId(),
      organizationId: organizationId.toHexString(),
      userId: input.userId,
      role: "owner",
      createdAt: now,
    });

    return {
      id: organizationId.toHexString(),
      name: input.name,
      slug,
      kind: "personal",
      createdByUserId: input.userId,
      createdAt: now,
      updatedAt: now,
    };
  }

  private async allocateSlug(name: string): Promise<string> {
    const base = normalizeProjectSlug(name) || "workspace";
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const existing = await this.organizations.findOne({ slug: candidate }, { projection: { _id: 1 } });
      if (existing === null) return candidate;
    }
    return `${base}-${Date.now()}`;
  }

  private toWorkspace(organization: OrganizationDocument): Workspace {
    const metadata = parseMetadata(organization.metadata);
    const createdAt =
      organization.createdAt instanceof Date
        ? organization.createdAt.toISOString()
        : (organization.createdAt ?? new Date(0).toISOString());

    return {
      id: idToString(organization._id),
      name: organization.name,
      slug: organization.slug,
      kind: metadata.kind,
      createdByUserId: metadata.createdByUserId,
      createdAt,
      updatedAt: createdAt,
    };
  }
}
