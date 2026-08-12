import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  CampaignRepository,
  campaignInputSchema,
  ensureCampaignIndexes,
  type CampaignInput,
} from "../src/modules/campaigns/repository";
import type { WorkspaceContext } from "../src/modules/projects/repository";
import { startTestDatabase, type TestDatabase } from "./mongo";

let database: TestDatabase;
let repository: CampaignRepository;

const tenantA: WorkspaceContext = { workspaceId: "workspace-a", userId: "user-a" };
const tenantB: WorkspaceContext = { workspaceId: "workspace-b", userId: "user-b" };

const campaign = (overrides: Partial<CampaignInput> = {}): CampaignInput => ({
  name: "Spring launch",
  status: "active",
  ...overrides,
});

beforeAll(async () => {
  database = await startTestDatabase();
  await ensureCampaignIndexes(database.db);
  repository = new CampaignRepository(database.db);
}, 120_000);

afterAll(async () => {
  await database?.stop();
});

beforeEach(async () => {
  await database.clear();
  await ensureCampaignIndexes(database.db);
});

describe("validation", () => {
  it("requires a name and a known status", () => {
    expect(campaignInputSchema.safeParse(campaign({ name: " " })).success).toBe(false);
    expect(campaignInputSchema.safeParse({ ...campaign(), status: "running" }).success).toBe(false);
  });

  it("refuses a campaign that ends before it starts", () => {
    const parsed = campaignInputSchema.safeParse(
      campaign({ startsAt: "2026-09-01", endsAt: "2026-08-01" }),
    );
    expect(parsed.success).toBe(false);
  });

  it("allows an open-ended campaign", () => {
    expect(campaignInputSchema.safeParse(campaign({ startsAt: "2026-08-01" })).success).toBe(true);
  });

  it("carries no performance field, so nothing fabricated can be stored", () => {
    expect(campaignInputSchema.safeParse({ ...campaign(), impressions: 1000 }).success).toBe(false);
    expect(campaignInputSchema.safeParse({ ...campaign(), clicks: 50 }).success).toBe(false);
  });
});

describe("tenant isolation", () => {
  it("does not list, read, update or delete across workspaces", async () => {
    const created = await repository.create(tenantA, campaign());

    expect(await repository.list(tenantB)).toHaveLength(0);
    expect(await repository.findById(tenantB, created.id)).toBeNull();
    expect(await repository.update(tenantB, created.id, { name: "Stolen" })).toBeNull();
    expect(await repository.delete(tenantB, created.id)).toBe(false);

    expect((await repository.findById(tenantA, created.id))?.name).toBe("Spring launch");
  });
});

describe("scoping", () => {
  it("filters by client and by site", async () => {
    await repository.create(tenantA, campaign({ name: "For client", clientId: "c1" }));
    await repository.create(tenantA, campaign({ name: "For site", projectId: "p1" }));
    await repository.create(tenantA, campaign({ name: "Workspace wide" }));

    expect((await repository.list(tenantA, { clientId: "c1" })).map((c) => c.name)).toEqual(["For client"]);
    expect((await repository.list(tenantA, { projectId: "p1" })).map((c) => c.name)).toEqual(["For site"]);
    expect(await repository.list(tenantA)).toHaveLength(3);
  });

  it("filters by status", async () => {
    await repository.create(tenantA, campaign({ name: "Running" }));
    await repository.create(tenantA, campaign({ name: "Done", status: "completed" }));

    expect((await repository.list(tenantA, { status: "completed" })).map((c) => c.name)).toEqual(["Done"]);
  });
});

describe("activeAndUpcoming", () => {
  it("includes active and draft campaigns that have not ended", async () => {
    await repository.create(tenantA, campaign({ name: "Running", endsAt: "2026-12-01" }));
    await repository.create(tenantA, campaign({ name: "Planned", status: "draft", startsAt: "2026-11-01" }));
    await repository.create(tenantA, campaign({ name: "Finished", status: "completed" }));
    await repository.create(tenantA, campaign({ name: "Expired", endsAt: "2026-01-01" }));

    const summary = await repository.activeAndUpcoming(tenantA, "2026-08-10");
    expect(summary.map((c) => c.name).sort()).toEqual(["Planned", "Running"]);
  });

  it("includes an open-ended campaign with no end date", async () => {
    await repository.create(tenantA, campaign({ name: "Ongoing" }));
    expect((await repository.activeAndUpcoming(tenantA, "2026-08-10")).map((c) => c.name)).toEqual(["Ongoing"]);
  });

  it("returns nothing from another workspace", async () => {
    await repository.create(tenantB, campaign({ name: "Theirs" }));
    expect(await repository.activeAndUpcoming(tenantA, "2026-08-10")).toHaveLength(0);
  });
});
