import { CLICK_GRID_COLUMNS, CLICK_GRID_ROWS, type AnalyticsBatch } from "@websitebuilder/shared";
import { describe, expect, it } from "vitest";

import { aggregateBatch, type AnalyticsIdentity } from "../src/modules/analytics/aggregate";

/**
 * The counting arithmetic, tested without a database.
 *
 * There is no raw event store, so nothing can be recomputed after the fact — this function is the
 * only place a miscount can be caught, and it is worth catching in milliseconds against fixtures
 * rather than in an integration test that would run it once.
 */

const identity: AnalyticsIdentity = {
  workspaceId: "workspace-a",
  projectId: "project-a",
  pageId: "page-home",
  versionId: "6a7b46cb9fbee814029888d4",
  host: "site.example.test",
  receivedAt: new Date("2026-08-11T14:30:00.000Z"),
};

const batch = (events: AnalyticsBatch["events"], overrides: Partial<AnalyticsBatch> = {}): AnalyticsBatch => ({
  schemaVersion: 1,
  batchId: "3f1a1c5e-6b2d-4a7f-9c11-2b0f6a8d4e51",
  sessionId: "8d4e51aa-6b2d-4a7f-9c11-2b0f6a8d4e52",
  pageViewId: "8d4e51bb-6b2d-4a7f-9c11-2b0f6a8d4e53",
  sentAt: "2026-08-11T14:30:00.000Z",
  path: "/",
  device: "desktop",
  source: { kind: "direct" },
  events,
  ...overrides,
});

/** The update document of the single session operation a batch produces. */
const sessionUpdate = (writes: ReturnType<typeof aggregateBatch>) =>
  (writes.sessions[0] as { updateOne: { update: Record<string, Record<string, unknown>> } }).updateOne.update;

const dailyIncrements = (writes: ReturnType<typeof aggregateBatch>) =>
  (writes.daily[0] as { updateOne: { update: { $inc: Record<string, number> } } } | undefined)?.updateOne.update
    .$inc ?? {};

const binOf = (writes: ReturnType<typeof aggregateBatch>, kind: string, key: string) =>
  (writes.bins as Array<{ updateOne: { filter: Record<string, unknown>; update: { $inc: Record<string, number> } } }>)
    .find((write) => write.updateOne.filter["kind"] === kind && write.updateOne.filter["key"] === key)?.updateOne
    .update.$inc;

describe("session accumulation", () => {
  it("uses only operators that survive arriving out of order", () => {
    const writes = aggregateBatch(identity, batch([{ type: "page_view" }]));
    const update = sessionUpdate(writes);

    // Every operator must be commutative. A `$set` on a counter, or a decrement anywhere, would make
    // the result depend on delivery order — and beacons are delivered by a network, not a queue.
    expect(Object.keys(update).sort()).toEqual(["$inc", "$max", "$setOnInsert"]);
    for (const value of Object.values(update["$inc"] ?? {})) expect(value).toBeGreaterThanOrEqual(0);
  });

  it("adds heartbeat and leave time rather than letting one replace the other", () => {
    const writes = aggregateBatch(
      identity,
      batch([
        { type: "engagement_heartbeat", engagedMs: 15_000 },
        { type: "engagement_heartbeat", engagedMs: 15_000 },
        { type: "page_leave", engagedMs: 4_000 },
      ]),
    );

    expect(sessionUpdate(writes)["$inc"]).toEqual({ pageViews: 0, engagedMs: 34_000, interactions: 0 });
  });

  it("fixes the session's dimensions at first sight and never rewrites them", () => {
    const writes = aggregateBatch(identity, batch([{ type: "page_view" }], { device: "mobile" }));
    const update = sessionUpdate(writes);

    expect(update["$setOnInsert"]).toMatchObject({ device: "mobile", host: "site.example.test", entryPageId: "page-home" });
    // A visitor who rotates a tablet is one session on the device they arrived with, not a session
    // that changes identity halfway through.
    expect(update["$set"]).toBeUndefined();
  });

  it("still touches the session when a batch carries only spatial events", () => {
    // Otherwise a visitor who scrolls without a heartbeat landing would leave a session whose last
    // activity is older than their real one, and the inactivity window would close early.
    const writes = aggregateBatch(identity, batch([{ type: "scroll_depth", percent: 50 }]));

    expect(sessionUpdate(writes)["$max"]).toEqual({ lastEventAt: identity.receivedAt });
    expect(sessionUpdate(writes)["$inc"]).toBeUndefined();
  });
});

describe("clicks", () => {
  it("counts one interaction per physical click, not one per event describing it", () => {
    // A click on a button produces both a region click and an element click. Counting both would
    // make every button worth two clicks and every piece of plain text worth none.
    const writes = aggregateBatch(
      identity,
      batch([
        { type: "page_region_click", x: 0.5, y: 0.5 },
        { type: "element_click", elementId: "cta-primary" },
      ]),
    );

    expect(sessionUpdate(writes)["$inc"]).toMatchObject({ interactions: 1 });
    expect(dailyIncrements(writes)).toMatchObject({ clicks: 1 });
    expect(binOf(writes, "element", "cta-primary")).toEqual({ count: 1 });
  });

  it("places a click in the cell its coordinates fall in", () => {
    const writes = aggregateBatch(identity, batch([{ type: "page_region_click", x: 0.5, y: 0.25 }]));

    const column = Math.floor(0.5 * CLICK_GRID_COLUMNS);
    const row = Math.floor(0.25 * CLICK_GRID_ROWS);
    expect(binOf(writes, "click", `${column}:${row}`)).toEqual({ count: 1 });
  });

  it("keeps a click at the far edge inside the grid", () => {
    // `x: 1` is a click on the last pixel, not a click one cell past the end of the page.
    const writes = aggregateBatch(identity, batch([{ type: "page_region_click", x: 1, y: 1 }]));

    expect(binOf(writes, "click", `${CLICK_GRID_COLUMNS - 1}:${CLICK_GRID_ROWS - 1}`)).toEqual({ count: 1 });
  });

  it("merges repeated clicks on the same cell into one write", () => {
    const writes = aggregateBatch(
      identity,
      batch([
        { type: "page_region_click", x: 0.5, y: 0.5 },
        { type: "page_region_click", x: 0.5, y: 0.5 },
        { type: "page_region_click", x: 0.5, y: 0.5 },
      ]),
    );

    expect(writes.bins).toHaveLength(1);
    expect(Object.values(binOf(writes, "click", "20:30") ?? {})).toEqual([3]);
  });
});

describe("scroll and sections", () => {
  it("counts a depth in both the daily counter and the page's bins", () => {
    const writes = aggregateBatch(identity, batch([{ type: "scroll_depth", percent: 75 }]));

    expect(dailyIncrements(writes)).toEqual({ "scroll.75": 1 });
    expect(binOf(writes, "scroll", "75")).toEqual({ count: 1 });
  });

  it("accumulates attention time and view count for a section together", () => {
    const writes = aggregateBatch(
      identity,
      batch([
        { type: "section_visibility", sectionId: "hero", visibleMs: 2_000 },
        { type: "section_visibility", sectionId: "hero", visibleMs: 3_000 },
        { type: "section_visibility", sectionId: "pricing", visibleMs: 1_000 },
      ]),
    );

    expect(binOf(writes, "section", "hero")).toEqual({ count: 2, ms: 5_000 });
    expect(binOf(writes, "section", "pricing")).toEqual({ count: 1, ms: 1_000 });
  });

  it("omits the attention field where nothing accumulated it", () => {
    const writes = aggregateBatch(identity, batch([{ type: "scroll_depth", percent: 25 }]));
    expect(binOf(writes, "scroll", "25")).toEqual({ count: 1 });
  });
});

describe("Web Vitals", () => {
  it("counts a sample into a bucket, never storing the value", () => {
    const writes = aggregateBatch(identity, batch([{ type: "web_vital", metric: "LCP", value: 2_400 }]));

    const write = writes.vitals[0] as { updateOne: { filter: Record<string, unknown>; update: unknown } };
    expect(write.updateOne.filter).toMatchObject({ metric: "LCP", device: "desktop", pageId: "page-home" });
    expect(write.updateOne.filter).not.toHaveProperty("value");
    expect(write.updateOne.update).toEqual({ $inc: { count: 1 } });
  });

  it("merges samples that land in the same bucket and separates ones that do not", () => {
    const writes = aggregateBatch(
      identity,
      batch([
        { type: "web_vital", metric: "LCP", value: 2_400 },
        { type: "web_vital", metric: "LCP", value: 2_401 },
        { type: "web_vital", metric: "LCP", value: 9_000 },
      ]),
    );

    expect(writes.vitals.length).toBeGreaterThan(1);
    const total = (writes.vitals as Array<{ updateOne: { update: { $inc: { count: number } } } }>).reduce(
      (sum, write) => sum + write.updateOne.update.$inc.count,
      0,
    );
    expect(total).toBe(3);
  });
});

describe("tenancy and determinism", () => {
  it("scopes every write by workspace and project", () => {
    const writes = aggregateBatch(
      identity,
      batch([
        { type: "page_view" },
        { type: "page_region_click", x: 0.1, y: 0.1 },
        { type: "web_vital", metric: "CLS", value: 0.05 },
      ]),
    );

    const all = [...writes.sessions, ...writes.daily, ...writes.bins, ...writes.vitals] as Array<{
      updateOne: { filter: Record<string, unknown> };
    }>;

    expect(all.length).toBeGreaterThan(3);
    for (const write of all) {
      expect(write.updateOne.filter["workspaceId"]).toBe("workspace-a");
      expect(write.updateOne.filter["projectId"]).toBe("project-a");
    }
  });

  it("ties spatial data to a version and leaves everything else free of one", () => {
    // Traffic, engagement and vitals outlive a publish; only coordinates are meaningless without
    // the layout that produced them.
    const writes = aggregateBatch(
      identity,
      batch([
        { type: "page_view" },
        { type: "page_region_click", x: 0.2, y: 0.2 },
        { type: "web_vital", metric: "TTFB", value: 300 },
      ]),
    );

    for (const write of writes.bins as Array<{ updateOne: { filter: Record<string, unknown> } }>) {
      expect(write.updateOne.filter["versionId"]).toBe(identity.versionId);
    }
    for (const write of [...writes.sessions, ...writes.daily, ...writes.vitals] as Array<{
      updateOne: { filter: Record<string, unknown> };
    }>) {
      expect(write.updateOne.filter).not.toHaveProperty("versionId");
    }
  });

  it("produces the same writes for the same batch, every time", () => {
    // The property the deduplication upstream relies on: replaying a batch that was already applied
    // must produce writes identical to the ones that were applied, so rejecting it loses nothing.
    const events: AnalyticsBatch["events"] = [
      { type: "page_view" },
      { type: "scroll_depth", percent: 50 },
      { type: "section_visibility", sectionId: "hero", visibleMs: 1_000 },
      { type: "page_region_click", x: 0.3, y: 0.7 },
      { type: "web_vital", metric: "INP", value: 120 },
    ];

    expect(aggregateBatch(identity, batch(events))).toEqual(aggregateBatch(identity, batch(events)));
  });

  it("writes nothing anywhere for a batch whose events all carry zero", () => {
    const writes = aggregateBatch(identity, batch([{ type: "engagement_heartbeat", engagedMs: 0 }]));

    expect(writes.daily).toEqual([]);
    expect(writes.bins).toEqual([]);
    expect(writes.vitals).toEqual([]);
    // The session is still touched, because the visitor is still there.
    expect(writes.sessions).toHaveLength(1);
  });
});
