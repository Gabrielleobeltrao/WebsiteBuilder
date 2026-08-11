import { DEFAULT_ANALYTICS_SETTINGS, type AnalyticsBatch } from "@websitebuilder/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { aggregateBatch, type AnalyticsIdentity } from "../src/modules/analytics/aggregate";
import {
  ANALYTICS_COLLECTIONS,
  AnalyticsRepository,
  ensureAnalyticsIndexes,
  utcDay,
} from "../src/modules/analytics/repository";
import type { WorkspaceContext } from "../src/modules/projects/repository";
import { startTestDatabase, type TestDatabase } from "./mongo";

let database: TestDatabase;
let analytics: AnalyticsRepository;

const A: WorkspaceContext = { workspaceId: "workspace-a", userId: "user-a" };
const B: WorkspaceContext = { workspaceId: "workspace-b", userId: "user-b" };

const identity = (overrides: Partial<AnalyticsIdentity> = {}): AnalyticsIdentity => ({
  workspaceId: A.workspaceId,
  projectId: "project-a",
  pageId: "page-home",
  versionId: "6a7b46cb9fbee814029888d4",
  host: "site.example.test",
  receivedAt: new Date("2026-08-11T14:30:00.000Z"),
  ...overrides,
});

let batchCounter = 0;
const batch = (events: AnalyticsBatch["events"], overrides: Partial<AnalyticsBatch> = {}): AnalyticsBatch => {
  batchCounter += 1;
  return {
    schemaVersion: 1,
    batchId: `3f1a1c5e-6b2d-4a7f-9c11-2b0f6a8d4e${String(batchCounter).padStart(2, "0")}`,
    sessionId: "8d4e51aa-6b2d-4a7f-9c11-2b0f6a8d4e52",
    pageViewId: "8d4e51bb-6b2d-4a7f-9c11-2b0f6a8d4e53",
    sentAt: "2026-08-11T14:30:00.000Z",
    path: "/",
    device: "desktop",
    source: { kind: "direct" },
    events,
    ...overrides,
  };
};

const ingest = (who: AnalyticsIdentity, events: AnalyticsBatch["events"], overrides: Partial<AnalyticsBatch> = {}) =>
  analytics.apply(aggregateBatch(who, batch(events, overrides)));

beforeAll(async () => {
  database = await startTestDatabase();
  analytics = new AnalyticsRepository(database.db);
}, 120_000);

afterAll(async () => {
  await database.stop();
});

beforeEach(async () => {
  await database.clear();
  await ensureAnalyticsIndexes(database.db);
});

describe("indexes", () => {
  it("keys every counter by its own uniqueness, so concurrent writers merge instead of duplicating", async () => {
    const unique = async (collection: string) =>
      (await database.db.collection(collection).indexes()).filter((index) => index["unique"] === true);

    expect(await unique(ANALYTICS_COLLECTIONS.sessions)).toHaveLength(1);
    expect(await unique(ANALYTICS_COLLECTIONS.daily)).toHaveLength(1);
    expect(await unique(ANALYTICS_COLLECTIONS.bins)).toHaveLength(1);
    expect(await unique(ANALYTICS_COLLECTIONS.vitals)).toHaveLength(1);
    expect(await unique(ANALYTICS_COLLECTIONS.settings)).toHaveLength(1);
  });

  it("starts every business index with the workspace", async () => {
    // Not only for speed: an index that cannot be used without the tenant key makes an accidentally
    // unscoped query obvious in profiling rather than quietly returning another tenant's rows.
    for (const collection of [
      ANALYTICS_COLLECTIONS.sessions,
      ANALYTICS_COLLECTIONS.daily,
      ANALYTICS_COLLECTIONS.bins,
      ANALYTICS_COLLECTIONS.vitals,
      ANALYTICS_COLLECTIONS.settings,
    ]) {
      const indexes = await database.db.collection(collection).indexes();
      for (const index of indexes) {
        const first = Object.keys(index["key"] as Record<string, unknown>)[0];
        // The retention index is keyed by time by necessity; every other one leads with the tenant.
        if (index["name"] === "retention" || index["name"] === "_id_") continue;
        expect(first, `${collection}.${String(index["name"])}`).toBe("workspaceId");
      }
    }
  });

  it("expires sessions sooner than counters, and dedup keys soonest of all", async () => {
    const ttl = async (collection: string) =>
      (await database.db.collection(collection).indexes()).find((index) => index["name"] === "retention")?.[
        "expireAfterSeconds"
      ] as number | undefined;

    const sessions = (await ttl(ANALYTICS_COLLECTIONS.sessions)) ?? 0;
    const daily = (await ttl(ANALYTICS_COLLECTIONS.daily)) ?? 0;
    const batches = (await ttl(ANALYTICS_COLLECTIONS.batches)) ?? 0;

    // Sessions are the only rows that describe one visit rather than a total, so they are the ones
    // that must not be kept a year.
    expect(sessions).toBeLessThan(daily);
    expect(batches).toBeLessThan(sessions);
    expect(await ttl(ANALYTICS_COLLECTIONS.bins)).toBeUndefined();
  });
});

describe("deduplication", () => {
  it("claims a batch once", async () => {
    const now = new Date();
    expect(await analytics.claimBatch("batch-1", now)).toBe(true);
    expect(await analytics.claimBatch("batch-1", now)).toBe(false);
    expect(await analytics.claimBatch("batch-2", now)).toBe(true);
  });

  it("means a replayed batch changes no counter", async () => {
    const events: AnalyticsBatch["events"] = [{ type: "page_view" }];
    const replayed = batch(events);

    for (const attempt of [1, 2, 3]) {
      if (await analytics.claimBatch(replayed.batchId, new Date())) {
        await analytics.apply(aggregateBatch(identity(), replayed));
      }
      expect(attempt).toBeGreaterThan(0);
    }

    const daily = await database.db.collection(ANALYTICS_COLLECTIONS.daily).findOne({});
    expect(daily?.["views"]).toBe(1);
  });
});

describe("applying a batch", () => {
  it("accumulates a session across several batches", async () => {
    await ingest(identity(), [{ type: "page_view" }]);
    await ingest(identity(), [{ type: "engagement_heartbeat", engagedMs: 15_000 }]);
    await ingest(identity(), [{ type: "page_view" }, { type: "page_region_click", x: 0.5, y: 0.5 }]);

    const session = await database.db.collection(ANALYTICS_COLLECTIONS.sessions).findOne({});
    expect(session).toMatchObject({ pageViews: 2, engagedMs: 15_000, interactions: 1, device: "desktop" });
  });

  it("keeps the first batch's dimensions when a later one disagrees", async () => {
    await ingest(identity(), [{ type: "page_view" }], { device: "desktop" });
    await ingest(identity(), [{ type: "page_view" }], { device: "mobile" });

    const session = await database.db.collection(ANALYTICS_COLLECTIONS.sessions).findOne({});
    expect(session?.["device"]).toBe("desktop");
    expect(session?.["pageViews"]).toBe(2);
  });

  it("does not drag a session's last activity backwards when a batch arrives late", async () => {
    const later = identity({ receivedAt: new Date("2026-08-11T15:00:00.000Z") });
    const earlier = identity({ receivedAt: new Date("2026-08-11T14:00:00.000Z") });

    await ingest(later, [{ type: "page_view" }]);
    await ingest(earlier, [{ type: "page_view" }]);

    const session = await database.db.collection(ANALYTICS_COLLECTIONS.sessions).findOne({});
    expect(session?.["lastEventAt"]).toEqual(later.receivedAt);
  });

  it("merges counters for the same page, day, device and source", async () => {
    await ingest(identity(), [{ type: "page_view" }]);
    await ingest(identity(), [{ type: "page_view" }]);

    const rows = await database.db.collection(ANALYTICS_COLLECTIONS.daily).find({}).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ views: 2, day: utcDay(identity().receivedAt) });
  });

  it("separates counters that differ in any dimension", async () => {
    await ingest(identity(), [{ type: "page_view" }], { device: "desktop" });
    await ingest(identity(), [{ type: "page_view" }], { device: "mobile" });
    await ingest(identity({ pageId: "page-about" }), [{ type: "page_view" }]);
    await ingest(identity(), [{ type: "page_view" }], { source: { kind: "external", host: "news.test" } });

    expect(await database.db.collection(ANALYTICS_COLLECTIONS.daily).countDocuments({})).toBe(4);
  });
});

describe("tenant isolation", () => {
  it("never merges two workspaces into one counter", async () => {
    await ingest(identity(), [{ type: "page_view" }]);
    await ingest(identity({ workspaceId: B.workspaceId }), [{ type: "page_view" }]);

    const rows = await database.db.collection(ANALYTICS_COLLECTIONS.daily).find({}).toArray();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row["workspaceId"]))).toEqual(new Set(["workspace-a", "workspace-b"]));
  });

  it("deletes only the project it was asked for", async () => {
    await ingest(identity(), [{ type: "page_view" }, { type: "page_region_click", x: 0.5, y: 0.5 }]);
    await ingest(identity({ projectId: "project-b" }), [{ type: "page_view" }]);
    await ingest(identity({ workspaceId: B.workspaceId, projectId: "project-a" }), [{ type: "page_view" }]);

    const deleted = await analytics.deleteProjectData(A, "project-a");

    expect(deleted["daily"]).toBe(1);
    expect(deleted["bins"]).toBe(1);
    // The other project and the other workspace are untouched, including the one that shares a
    // project id with the deleted one.
    expect(await database.db.collection(ANALYTICS_COLLECTIONS.daily).countDocuments({})).toBe(2);
  });

  it("cannot delete another workspace's project by naming it", async () => {
    await ingest(identity({ workspaceId: B.workspaceId }), [{ type: "page_view" }]);

    const deleted = await analytics.deleteProjectData(A, "project-a");

    expect(Object.values(deleted).every((count) => count === 0)).toBe(true);
    expect(await database.db.collection(ANALYTICS_COLLECTIONS.daily).countDocuments({})).toBe(1);
  });
});

describe("version lifetime", () => {
  it("removes the bins of a pruned version and keeps everything that outlives it", async () => {
    await ingest(identity({ versionId: "6a7b46cb9fbee814029888d4" }), [
      { type: "page_view" },
      { type: "page_region_click", x: 0.5, y: 0.5 },
      { type: "web_vital", metric: "LCP", value: 2000 },
    ]);
    await ingest(identity({ versionId: "6a7b46cb9fbee814029888d5" }), [
      { type: "page_region_click", x: 0.5, y: 0.5 },
    ]);

    const dropped = await analytics.dropVersionData(A, "project-a", ["6a7b46cb9fbee814029888d4"]);

    expect(dropped).toBe(1);
    // Traffic and performance survive the publish that pruned the layout; only coordinates go.
    expect(await database.db.collection(ANALYTICS_COLLECTIONS.daily).countDocuments({})).toBe(1);
    expect(await database.db.collection(ANALYTICS_COLLECTIONS.vitals).countDocuments({})).toBe(1);
    expect(await database.db.collection(ANALYTICS_COLLECTIONS.bins).countDocuments({})).toBe(1);
  });

  it("does nothing when asked to drop no versions", async () => {
    await ingest(identity(), [{ type: "page_region_click", x: 0.5, y: 0.5 }]);
    expect(await analytics.dropVersionData(A, "project-a", [])).toBe(0);
    expect(await database.db.collection(ANALYTICS_COLLECTIONS.bins).countDocuments({})).toBe(1);
  });

  it("cannot drop another workspace's bins", async () => {
    await ingest(identity({ workspaceId: B.workspaceId }), [{ type: "page_region_click", x: 0.5, y: 0.5 }]);
    expect(await analytics.dropVersionData(A, "project-a", ["6a7b46cb9fbee814029888d4"])).toBe(0);
  });
});

describe("settings", () => {
  it("reports the safe default for a project that has never been configured", async () => {
    expect(await analytics.loadSettings(A, "project-a")).toEqual(DEFAULT_ANALYTICS_SETTINGS);
    // Reading must not create a row: a site nobody has configured has no analytics record.
    expect(await database.db.collection(ANALYTICS_COLLECTIONS.settings).countDocuments({})).toBe(0);
  });

  it("round-trips a saved setting without leaking tenancy keys into the value", async () => {
    const settings = { ...DEFAULT_ANALYTICS_SETTINGS, enabled: true, retentionDays: 30 as const };
    await analytics.saveSettings(A, "project-a", settings);

    expect(await analytics.loadSettings(A, "project-a")).toEqual(settings);
  });

  it("keeps one row per project and updates it in place", async () => {
    await analytics.saveSettings(A, "project-a", { ...DEFAULT_ANALYTICS_SETTINGS, enabled: true });
    await analytics.saveSettings(A, "project-a", { ...DEFAULT_ANALYTICS_SETTINGS, enabled: false });

    expect(await database.db.collection(ANALYTICS_COLLECTIONS.settings).countDocuments({})).toBe(1);
    expect((await analytics.loadSettings(A, "project-a")).enabled).toBe(false);
  });

  it("does not read another workspace's settings", async () => {
    await analytics.saveSettings(B, "project-a", { ...DEFAULT_ANALYTICS_SETTINGS, enabled: true });
    expect((await analytics.loadSettings(A, "project-a")).enabled).toBe(false);
  });
});
