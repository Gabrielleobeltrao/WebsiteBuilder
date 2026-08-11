import {
  CLICK_GRID_COLUMNS,
  CLICK_GRID_ROWS,
  sourceLabel,
  webVitalBucket,
  type AnalyticsBatch,
  type DeviceCategory,
} from "@websitebuilder/shared";
import type { AnyBulkWriteOperation } from "mongodb";

import { utcDay } from "./repository";
import type { BinDocument, DailyDocument, SessionDocument, VitalDocument } from "./repository";

/**
 * Turns one validated batch into the writes it implies.
 *
 * A pure function with no database access, deliberately. There is no raw event store and therefore
 * no way to replay history and re-derive anything, so this arithmetic is the one place a
 * miscounting bug can be caught — and it can only be caught cheaply if it can be tested without a
 * database, against fixtures, in milliseconds.
 *
 * Every operator here is commutative: `$inc`, `$max`, `$setOnInsert`. Nothing decrements and nothing
 * overwrites a counter. That is what lets sessions be classified at query time instead of being
 * reclassified as they progress — a session that is bouncing at second five is not at second
 * eleven, and a design that had to correct itself by subtracting would double-count the first time
 * a retry landed.
 */

/** What the server knows about a batch. None of it comes from the browser. */
export type AnalyticsIdentity = {
  workspaceId: string;
  projectId: string;
  /** Resolved from the published route manifest, never from the reported path. */
  pageId: string;
  /** The version the page was rendered from, after the server verified the client's hint. */
  versionId: string;
  /** The hostname the request arrived on, from the resolved domain record. */
  host: string;
  receivedAt: Date;
};

export type AnalyticsWrites = {
  sessions: AnyBulkWriteOperation<SessionDocument>[];
  daily: AnyBulkWriteOperation<DailyDocument>[];
  bins: AnyBulkWriteOperation<BinDocument>[];
  vitals: AnyBulkWriteOperation<VitalDocument>[];
};

export function aggregateBatch(identity: AnalyticsIdentity, batch: AnalyticsBatch): AnalyticsWrites {
  const day = utcDay(identity.receivedAt);
  const source = sourceLabel(batch.source);

  const session = { pageViews: 0, engagedMs: 0, interactions: 0 };
  const daily = { views: 0, clicks: 0, scroll: new Map<number, number>() };
  const bins = new Map<string, { kind: BinDocument["kind"]; key: string; count: number; ms: number }>();
  const vitals = new Map<string, { metric: VitalDocument["metric"]; bucket: number; count: number }>();

  const bin = (kind: BinDocument["kind"], key: string) => {
    const id = `${kind}:${key}`;
    const existing = bins.get(id);
    if (existing !== undefined) return existing;
    const created = { kind, key, count: 0, ms: 0 };
    bins.set(id, created);
    return created;
  };

  for (const event of batch.events) {
    switch (event.type) {
      case "page_view":
        session.pageViews += 1;
        daily.views += 1;
        break;

      // A leave carries the engaged time not yet covered by a heartbeat, so the two add rather than
      // one superseding the other.
      case "engagement_heartbeat":
      case "page_leave":
        session.engagedMs += event.engagedMs;
        break;

      case "scroll_depth":
        daily.scroll.set(event.percent, (daily.scroll.get(event.percent) ?? 0) + 1);
        bin("scroll", String(event.percent)).count += 1;
        break;

      case "section_visibility": {
        const section = bin("section", event.sectionId);
        section.count += 1;
        section.ms += event.visibleMs;
        break;
      }

      // Element and region clicks describe the same physical click from two angles: every click
      // produces a region, and only a click on something with a stable id also produces an element.
      // Interactions and the click total are therefore counted from the region, or a click on a
      // button would count twice and a click on plain text would not count at all.
      case "page_region_click": {
        session.interactions += 1;
        daily.clicks += 1;
        const column = Math.min(CLICK_GRID_COLUMNS - 1, Math.floor(event.x * CLICK_GRID_COLUMNS));
        const row = Math.min(CLICK_GRID_ROWS - 1, Math.floor(event.y * CLICK_GRID_ROWS));
        bin("click", `${column}:${row}`).count += 1;
        break;
      }

      case "element_click":
        bin("element", event.elementId).count += 1;
        break;

      case "web_vital": {
        const bucket = webVitalBucket(event.metric, event.value);
        const id = `${event.metric}:${bucket}`;
        const existing = vitals.get(id);
        if (existing === undefined) vitals.set(id, { metric: event.metric, bucket, count: 1 });
        else existing.count += 1;
        break;
      }
    }
  }

  return {
    sessions: sessionWrite(identity, batch, session, source),
    daily: dailyWrite(identity, batch.device, day, source, daily),
    bins: binWrites(identity, batch.device, bins),
    vitals: vitalWrites(identity, batch.device, day, vitals),
  };
}

function sessionWrite(
  identity: AnalyticsIdentity,
  batch: AnalyticsBatch,
  totals: { pageViews: number; engagedMs: number; interactions: number },
  source: string,
): AnyBulkWriteOperation<SessionDocument>[] {
  const empty = totals.pageViews === 0 && totals.engagedMs === 0 && totals.interactions === 0;

  return [
    {
      updateOne: {
        filter: {
          workspaceId: identity.workspaceId,
          projectId: identity.projectId,
          sessionId: batch.sessionId,
        },
        update: {
          // `$max` rather than `$set`: batches can arrive out of order, and a late one must not drag
          // the session's last activity backwards.
          $max: { lastEventAt: identity.receivedAt },
          ...(empty ? {} : { $inc: totals }),
          $setOnInsert: {
            startedAt: identity.receivedAt,
            day: utcDay(identity.receivedAt),
            // Session dimensions are fixed at first sight. A visitor who rotates a tablet mid-visit
            // is one session on the device they arrived with, not two halves of one.
            device: batch.device,
            source,
            host: identity.host,
            entryPageId: identity.pageId,
          },
        },
        upsert: true,
      },
    },
  ];
}

function dailyWrite(
  identity: AnalyticsIdentity,
  device: DeviceCategory,
  day: Date,
  source: string,
  totals: { views: number; clicks: number; scroll: Map<number, number> },
): AnyBulkWriteOperation<DailyDocument>[] {
  const increments: Record<string, number> = {};
  if (totals.views > 0) increments["views"] = totals.views;
  if (totals.clicks > 0) increments["clicks"] = totals.clicks;
  for (const [bucket, count] of totals.scroll) increments[`scroll.${bucket}`] = count;

  if (Object.keys(increments).length === 0) return [];

  return [
    {
      updateOne: {
        filter: {
          workspaceId: identity.workspaceId,
          projectId: identity.projectId,
          day,
          pageId: identity.pageId,
          device,
          source,
        },
        update: { $inc: increments },
        upsert: true,
      } as never,
    },
  ];
}

function binWrites(
  identity: AnalyticsIdentity,
  device: DeviceCategory,
  bins: Map<string, { kind: BinDocument["kind"]; key: string; count: number; ms: number }>,
): AnyBulkWriteOperation<BinDocument>[] {
  return [...bins.values()].map((entry) => ({
    updateOne: {
      filter: {
        workspaceId: identity.workspaceId,
        projectId: identity.projectId,
        versionId: identity.versionId,
        pageId: identity.pageId,
        device,
        kind: entry.kind,
        key: entry.key,
      },
      update: { $inc: entry.ms === 0 ? { count: entry.count } : { count: entry.count, ms: entry.ms } },
      upsert: true,
    } as never,
  }));
}

function vitalWrites(
  identity: AnalyticsIdentity,
  device: DeviceCategory,
  day: Date,
  vitals: Map<string, { metric: VitalDocument["metric"]; bucket: number; count: number }>,
): AnyBulkWriteOperation<VitalDocument>[] {
  return [...vitals.values()].map((entry) => ({
    updateOne: {
      filter: {
        workspaceId: identity.workspaceId,
        projectId: identity.projectId,
        day,
        pageId: identity.pageId,
        device,
        metric: entry.metric,
        bucket: entry.bucket,
      },
      update: { $inc: { count: entry.count } },
      upsert: true,
    } as never,
  }));
}
