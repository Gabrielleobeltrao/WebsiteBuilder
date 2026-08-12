import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  canGrantRole,
  invitationInputSchema,
  MemberRepository,
  MembershipError,
} from "../src/modules/workspaces/members";
import { startTestDatabase, type TestDatabase } from "./mongo";

let database: TestDatabase;
let repository: MemberRepository;

const WORKSPACE = "workspace-a";

async function addMember(userId: string, role: string) {
  await database.db.collection("member").insertOne({
    _id: new ObjectId(),
    organizationId: WORKSPACE,
    userId,
    role,
    createdAt: new Date().toISOString(),
  });
}

beforeAll(async () => {
  database = await startTestDatabase();
  repository = new MemberRepository(database.db);
}, 120_000);

afterAll(async () => {
  await database?.stop();
});

beforeEach(async () => {
  await database.clear();
});

describe("canGrantRole", () => {
  it("lets an actor grant their own role or lower", () => {
    expect(canGrantRole("owner", "owner")).toBe(true);
    expect(canGrantRole("admin", "designer")).toBe(true);
    expect(canGrantRole("admin", "admin")).toBe(true);
  });

  it("refuses granting above the actor's own role", () => {
    expect(canGrantRole("admin", "owner")).toBe(false);
    expect(canGrantRole("designer", "admin")).toBe(false);
    expect(canGrantRole("viewer", "editor")).toBe(false);
  });
});

describe("last owner protection", () => {
  it("refuses to demote the only owner", async () => {
    await addMember("alice", "owner");

    await expect(
      repository.changeRole({ workspaceId: WORKSPACE, actorRole: "owner", targetUserId: "alice", role: "admin" }),
    ).rejects.toMatchObject({ reason: "last-owner" });

    expect((await repository.list(WORKSPACE))[0]?.role).toBe("owner");
  });

  it("refuses to remove the only owner", async () => {
    await addMember("alice", "owner");
    await expect(repository.remove({ workspaceId: WORKSPACE, targetUserId: "alice" })).rejects.toBeInstanceOf(
      MembershipError,
    );
  });

  it("allows demoting an owner once another exists", async () => {
    await addMember("alice", "owner");
    await addMember("bob", "owner");

    const changed = await repository.changeRole({
      workspaceId: WORKSPACE,
      actorRole: "owner",
      targetUserId: "alice",
      role: "admin",
    });
    expect(changed.role).toBe("admin");
    expect(await repository.countOwners(WORKSPACE)).toBe(1);
  });

  it("allows removing a non-owner", async () => {
    await addMember("alice", "owner");
    await addMember("bob", "editor");

    await repository.remove({ workspaceId: WORKSPACE, targetUserId: "bob" });
    expect((await repository.list(WORKSPACE)).map((m) => m.userId)).toEqual(["alice"]);
  });
});

describe("privilege escalation", () => {
  it("refuses an admin promoting anyone to owner", async () => {
    await addMember("alice", "owner");
    await addMember("bob", "admin");

    await expect(
      repository.changeRole({ workspaceId: WORKSPACE, actorRole: "admin", targetUserId: "bob", role: "owner" }),
    ).rejects.toMatchObject({ reason: "role-above-own" });
  });

  it("refuses an admin inviting an owner", async () => {
    await expect(
      repository.invite({
        workspaceId: WORKSPACE,
        actorRole: "admin",
        invitedByUserId: "bob",
        invitation: { email: "new@example.com", role: "owner" },
      }),
    ).rejects.toMatchObject({ reason: "role-above-own" });
  });

  it("refuses changing the role of someone who is not a member", async () => {
    await expect(
      repository.changeRole({ workspaceId: WORKSPACE, actorRole: "owner", targetUserId: "ghost", role: "editor" }),
    ).rejects.toMatchObject({ reason: "not-a-member" });
  });
});

describe("invitations", () => {
  it("validates the email and role", () => {
    expect(invitationInputSchema.safeParse({ email: "not-an-email", role: "editor" }).success).toBe(false);
    expect(invitationInputSchema.safeParse({ email: "a@b.com", role: "superadmin" }).success).toBe(false);
    expect(invitationInputSchema.safeParse({ email: "A@B.com", role: "editor" }).data?.email).toBe("a@b.com");
  });

  it("creates a pending invitation with an expiry", async () => {
    const invitation = await repository.invite({
      workspaceId: WORKSPACE,
      actorRole: "owner",
      invitedByUserId: "alice",
      invitation: { email: "new@example.com", role: "editor" },
    });

    expect(invitation.status).toBe("pending");
    expect(invitation.expiresAt > invitation.createdAt).toBe(true);
  });

  it("reports an expired invitation as expired rather than actionable", async () => {
    await repository.invite({
      workspaceId: WORKSPACE,
      actorRole: "owner",
      invitedByUserId: "alice",
      invitation: { email: "new@example.com", role: "editor" },
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const listed = await repository.listInvitations(WORKSPACE, "2026-08-10T00:00:00.000Z");
    expect(listed[0]?.status).toBe("expired");
  });

  it("refuses to accept an expired invitation", async () => {
    const invitation = await repository.invite({
      workspaceId: WORKSPACE,
      actorRole: "owner",
      invitedByUserId: "alice",
      invitation: { email: "new@example.com", role: "editor" },
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    await expect(
      repository.acceptInvitation({
        workspaceId: WORKSPACE,
        invitationId: invitation.id,
        userId: "bob",
        now: "2026-08-10T00:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(MembershipError);
  });

  it("accepts once and refuses a second acceptance", async () => {
    const invitation = await repository.invite({
      workspaceId: WORKSPACE,
      actorRole: "owner",
      invitedByUserId: "alice",
      invitation: { email: "new@example.com", role: "editor" },
    });

    const member = await repository.acceptInvitation({
      workspaceId: WORKSPACE,
      invitationId: invitation.id,
      userId: "bob",
    });
    expect(member.role).toBe("editor");

    await expect(
      repository.acceptInvitation({ workspaceId: WORKSPACE, invitationId: invitation.id, userId: "bob" }),
    ).rejects.toBeInstanceOf(MembershipError);
    expect((await repository.list(WORKSPACE)).filter((m) => m.userId === "bob")).toHaveLength(1);
  });

  it("cannot be accepted after being revoked", async () => {
    const invitation = await repository.invite({
      workspaceId: WORKSPACE,
      actorRole: "owner",
      invitedByUserId: "alice",
      invitation: { email: "new@example.com", role: "editor" },
    });

    expect(await repository.revokeInvitation(WORKSPACE, invitation.id)).toBe(true);
    await expect(
      repository.acceptInvitation({ workspaceId: WORKSPACE, invitationId: invitation.id, userId: "bob" }),
    ).rejects.toBeInstanceOf(MembershipError);
  });

  it("cannot be revoked from another workspace", async () => {
    const invitation = await repository.invite({
      workspaceId: WORKSPACE,
      actorRole: "owner",
      invitedByUserId: "alice",
      invitation: { email: "new@example.com", role: "editor" },
    });
    expect(await repository.revokeInvitation("workspace-b", invitation.id)).toBe(false);
  });
});
