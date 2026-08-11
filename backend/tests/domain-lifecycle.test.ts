import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DomainService } from "../src/modules/domains/service";
import { FakeHostnameProvider } from "../src/modules/domains/fakeProvider";
import { ProviderError } from "../src/modules/domains/provider";
import { UnconfiguredHostnameProvider } from "../src/modules/domains/unconfiguredProvider";
import type { WorkspaceContext } from "../src/modules/projects/repository";
import { ensurePublishingIndexes, PublishingRepository, PUBLISHING_COLLECTIONS } from "../src/modules/publishing/repository";
import { COLLECTIONS } from "../src/db/indexes";
import { startTestDatabase, type TestDatabase } from "./mongo";

let database: TestDatabase;
let provider: FakeHostnameProvider;
let service: DomainService;
let publishing: PublishingRepository;

const A: WorkspaceContext = { workspaceId: "workspace-a", userId: "user-a" };
const B: WorkspaceContext = { workspaceId: "workspace-b", userId: "user-b" };
const PROJECT = new ObjectId().toHexString();

const idOf = (value: string) => new ObjectId(value);

beforeAll(async () => {
  database = await startTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.stop();
});

beforeEach(async () => {
  await database.clear();
  await ensurePublishingIndexes(database.db);
  provider = new FakeHostnameProvider();
  service = new DomainService(database.db, provider, "platform.test");
  publishing = new PublishingRepository(database.db, database.db.collection(COLLECTIONS.projects));
});

describe("connect", () => {
  it("records the claim and returns the DNS instructions", async () => {
    const outcome = await service.connect(A, PROJECT, "WWW.Customer.test");

    expect(outcome.status).toBe("connected");
    if (outcome.status !== "connected") return;
    expect(outcome.domain.hostname).toBe("www.customer.test");
    expect(outcome.domain.status).toBe("pending_dns");
    expect(outcome.domain.verification?.method).toBe("cname");
  });

  it("refuses a hostname inside the platform's own space", async () => {
    expect((await service.connect(A, PROJECT, "anything.platform.test")).status).toBe("rejected");
  });

  it("gives one answer whether the hostname is taken by this project or another customer", async () => {
    await service.connect(A, PROJECT, "www.customer.test");

    const sameProject = await service.connect(A, PROJECT, "www.customer.test");
    const otherTenant = await service.connect(B, new ObjectId().toHexString(), "www.customer.test");

    expect(sameProject).toEqual(otherTenant);
  });

  it("keeps the claim when the provider is unreachable", async () => {
    provider.failNextWith = new ProviderError("unavailable", "down");

    const outcome = await service.connect(A, PROJECT, "www.customer.test");

    expect(outcome.status).toBe("pending-provider");
    // The record exists, so the customer does not have to start over once the provider recovers.
    expect(await publishing.listDomains(A, PROJECT)).toHaveLength(1);
  });
});

describe("refresh", () => {
  it("walks the real stages and only reports active when everything is complete", async () => {
    const created = await service.connect(A, PROJECT, "www.customer.test");
    if (created.status !== "connected") throw new Error("setup failed");
    const domainId = idOf(created.domain.id);
    const providerId = created.domain.providerHostnameId!;

    provider.advance(providerId, { ownershipVerified: true });
    expect((await service.refresh(A, domainId))?.status).toBe("pending_ssl");

    provider.advance(providerId, { sslStatus: "active" });
    const live = await service.refresh(A, domainId);
    expect(live?.status).toBe("active");
    expect(live?.verifiedAt).toBeDefined();
  });

  it("does not demote a live domain when the provider is temporarily unavailable", async () => {
    const created = await service.connect(A, PROJECT, "www.customer.test");
    if (created.status !== "connected") throw new Error("setup failed");
    const domainId = idOf(created.domain.id);

    provider.advance(created.domain.providerHostnameId!, { ownershipVerified: true, sslStatus: "active" });
    await service.refresh(A, domainId);

    provider.failNextWith = new ProviderError("unavailable", "down");
    const during = await service.refresh(A, domainId);

    // An outage must never take a working customer site offline.
    expect(during?.status).toBe("active");
    expect(during?.failureCode).toBe("unavailable");
    expect(await publishing.resolvePublicHost("www.customer.test")).not.toBeNull();
  });

  it("picks up a claim whose provider registration never happened", async () => {
    provider.failNextWith = new ProviderError("unavailable", "down");
    const created = await service.connect(A, PROJECT, "www.customer.test");
    if (created.status === "rejected") throw new Error("setup failed");

    const refreshed = await service.refresh(A, idOf(created.domain.id));
    expect(refreshed?.providerHostnameId).toBeDefined();
  });

  it("refuses to read another workspace's domain", async () => {
    const created = await service.connect(A, PROJECT, "www.customer.test");
    if (created.status === "rejected") throw new Error("setup failed");
    expect(await service.refresh(B, idOf(created.domain.id))).toBeNull();
  });
});

describe("disconnect", () => {
  it("removes the address without touching the project or its platform hostname", async () => {
    await publishing.ensurePlatformDomain(A, PROJECT, "acme", "platform.test");
    const created = await service.connect(A, PROJECT, "www.customer.test");
    if (created.status === "rejected") throw new Error("setup failed");

    expect(await service.disconnect(A, idOf(created.domain.id))).toBe(true);

    const remaining = await publishing.listDomains(A, PROJECT);
    expect(remaining.map((domain) => domain.hostname)).toEqual(["acme.platform.test"]);
  });

  it("still releases the domain when the provider call fails retryably", async () => {
    const created = await service.connect(A, PROJECT, "www.customer.test");
    if (created.status === "rejected") throw new Error("setup failed");
    provider.failNextWith = new ProviderError("unavailable", "down");

    expect(await service.disconnect(A, idOf(created.domain.id))).toBe(true);
    expect(await publishing.listDomains(A, PROJECT)).toEqual([]);
  });

  it("refuses to remove a platform hostname", async () => {
    const platform = await publishing.ensurePlatformDomain(A, PROJECT, "acme", "platform.test");
    expect(await service.disconnect(A, idOf(platform!.id))).toBe(false);
  });

  it("refuses to remove another workspace's domain", async () => {
    const created = await service.connect(A, PROJECT, "www.customer.test");
    if (created.status === "rejected") throw new Error("setup failed");
    expect(await service.disconnect(B, idOf(created.domain.id))).toBe(false);
    expect(await publishing.listDomains(A, PROJECT)).toHaveLength(1);
  });
});

describe("canonical address", () => {
  it("only allows a live domain to become primary", async () => {
    const platform = await publishing.ensurePlatformDomain(A, PROJECT, "acme", "platform.test");
    const created = await service.connect(A, PROJECT, "www.customer.test");
    if (created.status !== "connected") throw new Error("setup failed");

    expect(await publishing.setPrimaryDomain(A, PROJECT, created.domain.id)).toBeNull();

    provider.advance(created.domain.providerHostnameId!, { ownershipVerified: true, sslStatus: "active" });
    await service.refresh(A, idOf(created.domain.id));

    const promoted = await publishing.setPrimaryDomain(A, PROJECT, created.domain.id);
    expect(promoted?.isPrimary).toBe(true);

    const domains = await publishing.listDomains(A, PROJECT);
    expect(domains.filter((domain) => domain.isPrimary)).toHaveLength(1);
    expect(platform!.hostname).toBe("acme.platform.test");
  });
});

describe("storage", () => {
  it("keeps hostnames globally unique across tenants", async () => {
    await service.connect(A, PROJECT, "www.customer.test");
    const count = await database.db.collection(PUBLISHING_COLLECTIONS.domains).countDocuments({
      hostname: "www.customer.test",
    });
    expect(count).toBe(1);
  });
});

describe("without a configured provider", () => {
  /**
   * A deployment that has not set up Cloudflare still runs. Only connecting a customer's own domain
   * is refused, and it is refused rather than quietly accepted.
   */
  const unconfigured = () => new DomainService(database.db, new UnconfiguredHostnameProvider(), "platform.test");

  it("keeps the claim and says the provider is unavailable", async () => {
    const outcome = await unconfigured().connect(A, PROJECT, "www.customer.test");

    expect(outcome.status).toBe("pending-provider");
    if (outcome.status !== "pending-provider") return;
    expect(outcome.reason).toBe("unavailable");
  });

  it("never reports a domain as connected", async () => {
    const outcome = await unconfigured().connect(A, PROJECT, "www.customer.test");

    // The lie this exists to prevent: telling a customer their domain works while nothing was
    // registered anywhere.
    expect(outcome.status).not.toBe("connected");
    expect(await publishing.resolvePublicHost("www.customer.test")).toBeNull();
  });

  it("still lets a customer disconnect, so a domain cannot get stuck", async () => {
    const service = unconfigured();
    const created = await service.connect(A, PROJECT, "www.customer.test");
    if (created.status === "rejected") throw new Error("setup failed");

    expect(await service.disconnect(A, idOf(created.domain.id))).toBe(true);
  });

  it("leaves platform hostnames working, because they need no provider at all", async () => {
    await publishing.ensurePlatformDomain(A, PROJECT, "acme", "platform.test");
    expect((await publishing.listDomains(A, PROJECT)).map((domain) => domain.hostname)).toContain(
      "acme.platform.test",
    );
  });
});
