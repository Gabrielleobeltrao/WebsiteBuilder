import { ObjectId, type Collection, type Db } from "mongodb";
import { z } from "zod";

import { isWorkspaceRole, WORKSPACE_ROLES, type WorkspaceRole } from "./permissions";

/**
 * Workspace membership and invitations.
 *
 * Two rules protect a workspace from becoming unrecoverable:
 *
 * 1. The last owner cannot be removed or demoted. A workspace with no owner has no one who can
 *    restore access, invite anyone, or delete it — it is stranded, not merely misconfigured.
 * 2. Nobody can grant a role above their own. Without that, an admin could promote themselves to
 *    owner and the ownership rule above would mean nothing.
 */
export const invitationInputSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    role: z.enum(WORKSPACE_ROLES),
  })
  .strict();

export type InvitationInput = z.infer<typeof invitationInputSchema>;

export type Invitation = InvitationInput & {
  id: string;
  workspaceId: string;
  invitedByUserId: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  createdAt: string;
  expiresAt: string;
};

export type Member = { userId: string; role: WorkspaceRole; createdAt: string };

type InvitationDocument = Omit<Invitation, "id"> & { _id: ObjectId };
type MemberDocument = { _id: ObjectId; organizationId: string; userId: string; role: string; createdAt?: string };

export const INVITATION_TTL_DAYS = 14;

export class MembershipError extends Error {
  constructor(public readonly reason: "last-owner" | "role-above-own" | "not-a-member" | "already-member") {
    super(reason);
    this.name = "MembershipError";
  }
}

/** Higher index means more authority. Used only to compare, never to infer permissions. */
const RANK: Record<WorkspaceRole, number> = { viewer: 0, editor: 1, designer: 2, admin: 3, owner: 4 };

export function canGrantRole(actor: WorkspaceRole, target: WorkspaceRole): boolean {
  return RANK[target] <= RANK[actor];
}

export class MemberRepository {
  private readonly members: Collection<MemberDocument>;
  private readonly invitations: Collection<InvitationDocument>;

  constructor(db: Db) {
    this.members = db.collection<MemberDocument>("member");
    this.invitations = db.collection<InvitationDocument>("workspaceInvitations");
  }

  async list(workspaceId: string): Promise<Member[]> {
    const documents = await this.members.find({ organizationId: workspaceId }).toArray();
    return documents
      .filter((document) => isWorkspaceRole(document.role))
      .map((document) => ({
        userId: document.userId,
        role: document.role as WorkspaceRole,
        createdAt: document.createdAt ?? new Date(0).toISOString(),
      }));
  }

  async countOwners(workspaceId: string): Promise<number> {
    return this.members.countDocuments({ organizationId: workspaceId, role: "owner" });
  }

  async changeRole(input: {
    workspaceId: string;
    actorRole: WorkspaceRole;
    targetUserId: string;
    role: WorkspaceRole;
  }): Promise<Member> {
    if (!canGrantRole(input.actorRole, input.role)) throw new MembershipError("role-above-own");

    const existing = await this.members.findOne({
      organizationId: input.workspaceId,
      userId: input.targetUserId,
    });
    if (existing === null) throw new MembershipError("not-a-member");

    if (existing.role === "owner" && input.role !== "owner") {
      const owners = await this.countOwners(input.workspaceId);
      if (owners <= 1) throw new MembershipError("last-owner");
    }

    await this.members.updateOne(
      { organizationId: input.workspaceId, userId: input.targetUserId },
      { $set: { role: input.role } },
    );
    return { userId: input.targetUserId, role: input.role, createdAt: existing.createdAt ?? new Date().toISOString() };
  }

  async remove(input: { workspaceId: string; targetUserId: string }): Promise<void> {
    const existing = await this.members.findOne({
      organizationId: input.workspaceId,
      userId: input.targetUserId,
    });
    if (existing === null) throw new MembershipError("not-a-member");

    if (existing.role === "owner" && (await this.countOwners(input.workspaceId)) <= 1) {
      throw new MembershipError("last-owner");
    }
    await this.members.deleteOne({ organizationId: input.workspaceId, userId: input.targetUserId });
  }

  async invite(input: {
    workspaceId: string;
    actorRole: WorkspaceRole;
    invitedByUserId: string;
    invitation: InvitationInput;
    now?: Date;
  }): Promise<Invitation> {
    if (!canGrantRole(input.actorRole, input.invitation.role)) throw new MembershipError("role-above-own");

    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const document = {
      ...input.invitation,
      workspaceId: input.workspaceId,
      invitedByUserId: input.invitedByUserId,
      status: "pending" as const,
      createdAt: now.toISOString(),
      expiresAt,
    };

    const result = await this.invitations.insertOne(document as InvitationDocument);
    return { ...document, id: result.insertedId.toHexString() };
  }

  async listInvitations(workspaceId: string, now = new Date().toISOString()): Promise<Invitation[]> {
    const documents = await this.invitations.find({ workspaceId }, { sort: { createdAt: -1 } }).toArray();
    return documents.map((document) => {
      const { _id, ...rest } = document;
      // An expired invitation is reported as expired rather than left looking actionable.
      const status = rest.status === "pending" && rest.expiresAt < now ? ("expired" as const) : rest.status;
      return { ...rest, status, id: _id.toHexString() };
    });
  }

  async revokeInvitation(workspaceId: string, invitationId: string): Promise<boolean> {
    if (!ObjectId.isValid(invitationId) || invitationId.length !== 24) return false;
    const result = await this.invitations.updateOne(
      { _id: new ObjectId(invitationId), workspaceId, status: "pending" },
      { $set: { status: "revoked" } },
    );
    return result.modifiedCount === 1;
  }

  /** Accepts a pending, unexpired invitation and creates the membership exactly once. */
  async acceptInvitation(input: {
    workspaceId: string;
    invitationId: string;
    userId: string;
    now?: string;
  }): Promise<Member> {
    const now = input.now ?? new Date().toISOString();
    if (!ObjectId.isValid(input.invitationId) || input.invitationId.length !== 24) {
      throw new MembershipError("not-a-member");
    }

    const invitation = await this.invitations.findOne({
      _id: new ObjectId(input.invitationId),
      workspaceId: input.workspaceId,
      status: "pending",
    });
    if (invitation === null || invitation.expiresAt < now) throw new MembershipError("not-a-member");

    const existing = await this.members.findOne({
      organizationId: input.workspaceId,
      userId: input.userId,
    });
    if (existing !== null) throw new MembershipError("already-member");

    await this.members.insertOne({
      _id: new ObjectId(),
      organizationId: input.workspaceId,
      userId: input.userId,
      role: invitation.role,
      createdAt: now,
    });
    await this.invitations.updateOne({ _id: invitation._id }, { $set: { status: "accepted" } });

    return { userId: input.userId, role: invitation.role, createdAt: now };
  }
}
