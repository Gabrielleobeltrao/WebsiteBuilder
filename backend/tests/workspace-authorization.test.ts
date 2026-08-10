import type { Express } from "express";
import { ObjectId } from "mongodb";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { ApiProblem } from "../src/middleware/errors";
import { ProjectRepository } from "../src/modules/projects/repository";
import { createProjectsRouter } from "../src/modules/projects/routes";
import { WorkspaceRepository } from "../src/modules/workspaces/repository";
import { can, type Permission } from "../src/modules/workspaces/permissions";
import { testEnv, testLogger } from "./helpers";
import { startTestDatabase, type TestDatabase } from "./mongo";

/**
 * Adversarial tenancy tests.
 *
 * The session layer is stubbed to a chosen user so the assertions target what actually decides
 * access: the membership record and the role matrix, both read from the database.
 */

let database: TestDatabase;
let workspaces: WorkspaceRepository;
let projects: ProjectRepository;

const ALICE = "user-alice";
const BOB = "user-bob";

let workspaceA = "";
let workspaceB = "";

beforeAll(async () => {
  database = await startTestDatabase();
  workspaces = new WorkspaceRepository(database.db);
  projects = new ProjectRepository(database.db);
}, 120_000);

afterAll(async () => {
  await database.stop();
});

async function addMember(workspaceId: string, userId: string, role: string) {
  await database.db.collection("member").insertOne({
    _id: new ObjectId(),
    organizationId: workspaceId,
    userId,
    role,
    createdAt: new Date().toISOString(),
  });
}

beforeEach(async () => {
  await database.clear();
  const alicePersonal = await workspaces.ensurePersonalWorkspace({ userId: ALICE, name: "Alice" });
  const bobPersonal = await workspaces.ensurePersonalWorkspace({ userId: BOB, name: "Bob" });
  workspaceA = alicePersonal.id;
  workspaceB = bobPersonal.id;
});

/** Builds an app whose session always resolves to `userId`, with the real membership check. */
function appAs(userId: string | null, permission: Permission = "project:read"): Express {
  return createApp({
    env: testEnv(),
    logger: testLogger(),
    routers: [
      {
        path: "/workspaces/:workspaceId/projects",
        router: createProjectsRouter({
          repository: projects,
          // Mirrors the real resolver: the router declares a base permission and each route may
          // demand a stronger one.
          resolveWorkspace: async (req, required = permission) => {
            if (userId === null) throw new ApiProblem("UNAUTHENTICATED", "Authentication is required");
            const workspaceId = String(req.params.workspaceId ?? "");
            const membership = await workspaces.findMembership(workspaceId, userId);
            if (membership === null) throw new ApiProblem("FORBIDDEN", "You do not have access to this workspace");
            if (!can(membership.role, required)) throw new ApiProblem("FORBIDDEN", "Role does not allow this");
            return { workspaceId, userId };
          },
        }),
      },
    ],
  });
}

const base = (workspaceId: string) => `/api/v1/workspaces/${workspaceId}/projects`;

describe("personal workspace bootstrap", () => {
  it("creates exactly one personal workspace per user", async () => {
    const workspace = await workspaces.ensurePersonalWorkspace({ userId: ALICE, name: "Alice" });
    expect(workspace.id).toBe(workspaceA);
    expect(workspace.kind).toBe("personal");
  });

  it("is idempotent, so a retried signup cannot create a second home", async () => {
    await workspaces.ensurePersonalWorkspace({ userId: ALICE, name: "Alice" });
    await workspaces.ensurePersonalWorkspace({ userId: ALICE, name: "Alice" });

    const owned = await workspaces.listForUser(ALICE);
    expect(owned.filter((workspace) => workspace.kind === "personal")).toHaveLength(1);
  });

  it("makes the creator the owner", async () => {
    const membership = await workspaces.findMembership(workspaceA, ALICE);
    expect(membership?.role).toBe("owner");
  });

  it("lists only the workspaces a user belongs to", async () => {
    expect((await workspaces.listForUser(ALICE)).map((w) => w.id)).toEqual([workspaceA]);
    expect((await workspaces.listForUser(BOB)).map((w) => w.id)).toEqual([workspaceB]);
  });
});

describe("authentication", () => {
  it("refuses every business route without a session", async () => {
    const app = appAs(null);
    expect((await request(app).get(base(workspaceA))).status).toBe(401);
    expect((await request(app).post(base(workspaceA)).send({ name: "X" })).status).toBe(401);
  });
});

describe("cross-workspace isolation", () => {
  it("refuses a workspace the user is not a member of", async () => {
    const response = await request(appAs(ALICE)).get(base(workspaceB));
    expect(response.status).toBe(403);
  });

  it("gives the same answer for a non-member and a workspace that does not exist", async () => {
    const nonMember = await request(appAs(ALICE)).get(base(workspaceB));
    const missing = await request(appAs(ALICE)).get(base(new ObjectId().toHexString()));
    expect(nonMember.status).toBe(missing.status);
    expect(nonMember.body.error.code).toBe(missing.body.error.code);
  });

  it("cannot read another tenant's project even with the correct project id", async () => {
    const created = await projects.create({ workspaceId: workspaceB, userId: BOB }, { name: "Bob site" });
    const response = await request(appAs(ALICE)).get(`${base(workspaceB)}/${created.id}`);

    expect(response.status).toBe(403);
    expect(JSON.stringify(response.body)).not.toContain("Bob site");
  });

  it("cannot reach another tenant's project by naming its own workspace", async () => {
    const created = await projects.create({ workspaceId: workspaceB, userId: BOB }, { name: "Bob site" });
    const response = await request(appAs(ALICE)).get(`${base(workspaceA)}/${created.id}`);
    expect(response.status).toBe(404);
  });

  it("cannot delete across tenants", async () => {
    const created = await projects.create({ workspaceId: workspaceB, userId: BOB }, { name: "Bob site" });
    expect((await request(appAs(ALICE)).delete(`${base(workspaceB)}/${created.id}`)).status).toBe(403);
    expect(await projects.findById({ workspaceId: workspaceB, userId: BOB }, created.id)).not.toBeNull();
  });
});

describe("shared user with different roles", () => {
  it("applies the role held in that workspace, not the highest role held anywhere", async () => {
    // Bob is an owner of his own workspace and a viewer in Alice's.
    await addMember(workspaceA, BOB, "viewer");

    expect((await request(appAs(BOB, "project:read")).get(base(workspaceA))).status).toBe(200);
    expect((await request(appAs(BOB, "project:create")).post(base(workspaceA)).send({ name: "X" })).status).toBe(403);
    expect((await request(appAs(BOB, "project:create")).post(base(workspaceB)).send({ name: "X" })).status).toBe(201);
  });

  it("refuses a membership record carrying an unknown role", async () => {
    await addMember(workspaceA, BOB, "superadmin");
    expect((await request(appAs(BOB)).get(base(workspaceA))).status).toBe(403);
  });
});

describe("stale or forged workspace state", () => {
  it("ignores a workspace id supplied in the body", async () => {
    const response = await request(appAs(ALICE))
      .post(base(workspaceA))
      .send({ name: "Injected", workspaceId: workspaceB });
    expect(response.status).toBe(400);
  });

  it("stops granting access the moment a membership is removed", async () => {
    await addMember(workspaceA, BOB, "viewer");
    expect((await request(appAs(BOB)).get(base(workspaceA))).status).toBe(200);

    await database.db.collection("member").deleteOne({ organizationId: workspaceA, userId: BOB });
    expect((await request(appAs(BOB)).get(base(workspaceA))).status).toBe(403);
  });
});

describe("per-route permissions", () => {
  /**
   * The router is mounted with the permission its cheapest route needs. Every route that writes
   * must demand its own, or read access silently becomes write access.
   */
  it("refuses a write to a member who may only read", async () => {
    await addMember(workspaceB, ALICE, "viewer");
    const app = appAs(ALICE);

    const created = await request(app).post(base(workspaceB)).send({ name: "Theirs" });
    expect(created.status).toBe(403);

    const project = await projects.create({ workspaceId: workspaceB, userId: BOB }, { name: "Theirs" });
    const renamed = await request(app).patch(`${base(workspaceB)}/${project.id}`).send({ name: "Mine" });
    expect(renamed.status).toBe(403);

    const deleted = await request(app).delete(`${base(workspaceB)}/${project.id}`);
    expect(deleted.status).toBe(403);

    // The read the router was mounted for still works, so this is a permission check and not an
    // access failure.
    expect((await request(app).get(base(workspaceB))).status).toBe(200);
  });

  it("allows the same writes to a designer", async () => {
    await addMember(workspaceB, ALICE, "designer");
    const created = await request(appAs(ALICE)).post(base(workspaceB)).send({ name: "Fine" });
    expect(created.status).toBe(201);
  });
});
