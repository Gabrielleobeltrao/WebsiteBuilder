import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ClientRepository, clientInputSchema, type ClientInput } from "../src/modules/clients/repository";
import { ProjectRepository, type WorkspaceContext } from "../src/modules/projects/repository";
import { startTestDatabase, type TestDatabase } from "./mongo";

let database: TestDatabase;
let clients: ClientRepository;
let projects: ProjectRepository;

const tenantA: WorkspaceContext = { workspaceId: "workspace-a", userId: "user-a" };
const tenantB: WorkspaceContext = { workspaceId: "workspace-b", userId: "user-b" };

const client = (overrides: Partial<ClientInput> = {}): ClientInput => ({
  name: "Padaria Central",
  type: "company",
  status: "active",
  ...overrides,
});

beforeAll(async () => {
  database = await startTestDatabase();
  clients = new ClientRepository(database.db);
  projects = new ProjectRepository(database.db);
}, 120_000);

afterAll(async () => {
  await database.stop();
});

beforeEach(async () => {
  await database.clear();
});

describe("validation", () => {
  it("requires a name and a known type and status", () => {
    expect(clientInputSchema.safeParse(client({ name: "  " })).success).toBe(false);
    expect(clientInputSchema.safeParse({ ...client(), type: "robot" }).success).toBe(false);
    expect(clientInputSchema.safeParse({ ...client(), status: "deleted" }).success).toBe(false);
  });

  it("rejects unknown properties and an invalid contact email", () => {
    expect(clientInputSchema.safeParse({ ...client(), isAdmin: true }).success).toBe(false);
    expect(
      clientInputSchema.safeParse({ ...client(), primaryContact: { email: "not-an-email" } }).success,
    ).toBe(false);
  });
});

describe("tenant isolation", () => {
  it("does not list or read another workspace's clients", async () => {
    const created = await clients.create(tenantA, client());

    expect(await clients.list(tenantB)).toHaveLength(0);
    expect(await clients.findById(tenantB, created.id)).toBeNull();
  });

  it("does not update or archive across workspaces", async () => {
    const created = await clients.create(tenantA, client());

    expect(await clients.update(tenantB, created.id, { name: "Stolen" })).toBeNull();
    expect(await clients.archive(tenantB, created.id)).toBeNull();
    expect((await clients.findById(tenantA, created.id))?.name).toBe("Padaria Central");
  });

  it("treats a malformed id as not found", async () => {
    expect(await clients.findById(tenantA, "nope")).toBeNull();
    expect(await clients.update(tenantA, "nope", { name: "x" })).toBeNull();
  });
});

describe("listing", () => {
  it("filters by status", async () => {
    await clients.create(tenantA, client({ name: "Active one" }));
    await clients.create(tenantA, client({ name: "A lead", status: "lead" }));

    expect((await clients.list(tenantA, { status: "lead" })).map((c) => c.name)).toEqual(["A lead"]);
  });

  it("searches by name without letting the query act as a pattern", async () => {
    await clients.create(tenantA, client({ name: "Padaria Central" }));
    await clients.create(tenantA, client({ name: "Studio Norte" }));

    expect((await clients.list(tenantA, { search: "padaria" })).map((c) => c.name)).toEqual(["Padaria Central"]);
    expect(await clients.list(tenantA, { search: ".*" })).toHaveLength(0);
  });

  it("orders by most recently updated", async () => {
    const first = await clients.create(tenantA, client({ name: "First" }));
    await clients.create(tenantA, client({ name: "Second" }));
    await clients.update(tenantA, first.id, { notes: "touched" });

    expect((await clients.list(tenantA)).map((c) => c.name)).toEqual(["First", "Second"]);
  });
});

describe("archiving", () => {
  it("archives rather than deleting, so nothing a client owns is destroyed", async () => {
    const created = await clients.create(tenantA, client());
    const site = await projects.create(tenantA, { name: "Client site", clientId: created.id });

    const archived = await clients.archive(tenantA, created.id);
    expect(archived?.status).toBe("archived");

    // The record and its sites both survive; only the status changed.
    expect(await clients.findById(tenantA, created.id)).not.toBeNull();
    expect(await projects.findById(tenantA, site.id)).not.toBeNull();
  });

  it("keeps an archived client out of the active list but findable directly", async () => {
    const created = await clients.create(tenantA, client());
    await clients.archive(tenantA, created.id);

    expect((await clients.list(tenantA, { status: "active" })).map((c) => c.id)).not.toContain(created.id);
    expect(await clients.findById(tenantA, created.id)).not.toBeNull();
  });
});

describe("client-owned sites", () => {
  it("lists only the sites belonging to one client", async () => {
    const clientA = await clients.create(tenantA, client({ name: "A" }));
    const clientB = await clients.create(tenantA, client({ name: "B" }));

    await projects.create(tenantA, { name: "A site", clientId: clientA.id });
    await projects.create(tenantA, { name: "B site", clientId: clientB.id });
    await projects.create(tenantA, { name: "Direct site" });

    expect((await projects.listSummaries(tenantA, { clientId: clientA.id })).map((p) => p.name)).toEqual(["A site"]);
    // A personal workspace site with no client is still listed workspace-wide.
    expect((await projects.listSummaries(tenantA)).map((p) => p.name).sort()).toEqual([
      "A site",
      "B site",
      "Direct site",
    ]);
  });
});
