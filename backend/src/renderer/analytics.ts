import {
  analyticsBatchSchema,
  ANALYTICS_BATCH_MAX_BYTES,
  type AnalyticsSettings,
} from "@websitebuilder/shared";
import express, { Router, type Request } from "express";
import type { Logger } from "pino";

import { aggregateBatch } from "../modules/analytics/aggregate";
import { AnalyticsRepository, isLikelyBot } from "../modules/analytics/repository";
import type { PublishingRepository } from "../modules/publishing/repository";
import { TtlCache } from "./cache";
import { resolveRoute, type SiteResolver } from "./resolver";

/**
 * Analytics ingestion, on the published site's own origin.
 *
 * This is the only endpoint in the product that accepts a write from an unauthenticated stranger,
 * so everything here is arranged so that what a caller says cannot change where the data goes:
 *
 * - The workspace, project and page are derived from the hostname the request arrived on and the
 *   published route manifest. They do not appear in the payload schema at all.
 * - A path that is not a published route is discarded rather than stored, which is what keeps a
 *   caller from creating unbounded rows by inventing URLs.
 * - Responses say only whether the batch was taken. No field names, no validation detail: echoing a
 *   schema error tells an attacker exactly what shape to send next.
 * - Nothing about a visitor is logged, and nothing about a visitor is stored beyond a random
 *   identifier they generated and which expires.
 *
 * Cross-origin senders are excluded by construction rather than by a check. The endpoint accepts
 * only `application/json`, which a browser cannot send cross-origin without a preflight, and the
 * renderer has no CORS middleware to answer one. Do not add it.
 */

export type IngestionLimits = {
  /** Batches per window from one address. */
  perAddress: number;
  /** Batches per window for one project, so one busy site cannot exhaust the process. */
  perProject: number;
  windowMs: number;
};

export const DEFAULT_INGESTION_LIMITS: IngestionLimits = {
  perAddress: 60,
  perProject: 600,
  windowMs: 60_000,
};

/**
 * A fixed-window counter.
 *
 * Two windows rotated in place: when the window ends, the current map becomes the previous one and
 * a fresh map takes over. That bounds memory without an eviction policy, an LRU or a timer — the
 * whole structure is discarded on a schedule instead of being pruned.
 *
 * State is per process, deliberately. With several renderer replicas the effective limit is the
 * configured one times the replica count, which is documented in `docs/ANALYTICS_OPERATIONS.md`.
 * The alternatives were worse: Redis is a new deployment resource the architecture forbids, and a
 * database round-trip in front of every beacon would be a larger availability risk than the abuse
 * it prevents.
 */
class FixedWindowCounter {
  private current = new Map<string, number>();
  private windowStart: number;

  constructor(private readonly windowMs: number, now: number) {
    this.windowStart = now;
  }

  /** Returns true when the key is still within its allowance. */
  take(key: string, limit: number, now: number): boolean {
    if (now - this.windowStart >= this.windowMs) {
      this.current = new Map();
      this.windowStart = now;
    }

    const used = this.current.get(key) ?? 0;
    if (used >= limit) return false;
    this.current.set(key, used + 1);
    return true;
  }
}

export type AnalyticsIngestionDeps = {
  resolver: SiteResolver;
  analytics: AnalyticsRepository;
  publishing: PublishingRepository;
  logger: Logger;
  /** Site settings are read once per site per TTL rather than once per beacon. */
  settingsTtlSeconds?: number;
  limits?: IngestionLimits;
  /** Whether forwarded addresses can be trusted; when they cannot, address limiting is skipped. */
  trustsProxy: boolean;
  now?: () => Date;
};

export const ANALYTICS_EVENTS_PATH = "/__wb/events";

export function createAnalyticsIngestionRouter(deps: AnalyticsIngestionDeps): Router {
  const limits = deps.limits ?? DEFAULT_INGESTION_LIMITS;
  const now = deps.now ?? (() => new Date());
  const counter = new FixedWindowCounter(limits.windowMs, now().getTime());
  const settingsCache = new TtlCache<AnalyticsSettings>(Math.max(1, deps.settingsTtlSeconds ?? 60) * 1000);

  const router = Router();

  const loadSettings = async (projectId: string): Promise<AnalyticsSettings> => {
    const cached = settingsCache.get(projectId);
    if (cached !== undefined) return cached;

    const settings = await deps.analytics.loadPublicSettings(projectId);
    settingsCache.set(projectId, settings);
    return settings;
  };

  router.post(
    ANALYTICS_EVENTS_PATH,
    // Mounted on this route rather than on the app: a body parser in front of every published page
    // would be work done for every visitor of every tenant to serve one endpoint.
    express.json({ limit: ANALYTICS_BATCH_MAX_BYTES, type: "application/json" }),
    async (request, response) => {
      // 204 is the answer to almost everything, including refusal. A beacon has no user interface
      // to show an error in, and a distinguishable rejection is a probe result.
      const accepted = () => response.status(204).end();

      try {
        if (!request.is("application/json")) {
          response.status(415).type("text/plain").send("Unsupported Media Type");
          return;
        }

        const receivedAt = now();

        if (isLikelyBot(request.get("user-agent"))) {
          accepted();
          return;
        }

        // Address limiting only where a forwarded address can be believed. Without trusted proxy
        // ranges every visitor presents the gateway's address, and one bucket would throttle the
        // entire internet as a single client.
        if (deps.trustsProxy && !counter.take(`ip:${request.ip ?? ""}`, limits.perAddress, receivedAt.getTime())) {
          response.status(429).type("text/plain").send("Too Many Requests");
          return;
        }

        const site = await deps.resolver.resolve(hostnameOf(request));
        if (site === null) {
          // The same answer the page catch-all gives an unknown host, so this endpoint cannot be
          // used to discover which hostnames exist.
          response.status(404).type("text/plain").send("Not Found");
          return;
        }

        const { workspaceId, projectId } = site.version;

        if (!counter.take(`project:${projectId}`, limits.perProject, receivedAt.getTime())) {
          response.status(429).type("text/plain").send("Too Many Requests");
          return;
        }

        const settings = await loadSettings(projectId);
        // A site whose owner has not enabled collection is not measured, whatever arrives. The
        // tracker is not injected there either; this is the second of the two locks.
        if (!settings.enabled) {
          accepted();
          return;
        }

        const batch = analyticsBatchSchema.safeParse(request.body);
        if (!batch.success) {
          response.status(400).type("text/plain").send("Bad Request");
          return;
        }

        const outcome = resolveRoute(site.version, batch.data.path);
        // Only a real, published, successful route is counted. A request path is chosen by whoever
        // sends it, so counting one that was never published would let anyone grow this collection
        // without limit inside someone else's workspace.
        if (outcome.kind !== "route" || outcome.route.statusCode !== 200) {
          accepted();
          return;
        }

        const versionId = await resolveVersion(deps, projectId, site.version.id, batch.data.versionId);

        // The first write, before any counter moves: a beacon that was retried carries the id it was
        // assembled with, so the retry is recognised instead of counted again.
        if (!(await deps.analytics.claimBatch(batch.data.batchId, receivedAt))) {
          accepted();
          return;
        }

        await deps.analytics.apply(
          aggregateBatch(
            {
              workspaceId,
              projectId,
              pageId: outcome.route.resourceId,
              versionId,
              host: site.domain.hostname,
              receivedAt,
            },
            batch.data,
          ),
        );

        accepted();
      } catch (error) {
        // The host is the most that may be logged. Not the body, not an identifier, not the agent.
        deps.logger.warn({ err: error, host: hostnameOf(request) }, "an analytics batch could not be stored");
        response.status(500).type("text/plain").send("Internal Server Error");
      }
    },
  );

  return router;
}

/**
 * Which layout the visitor was actually looking at.
 *
 * The browser reports it because the active pointer may have moved after the page loaded, and
 * attributing someone's clicks to a layout they never saw is the stale-overlay problem heatmaps
 * exist to avoid. The report is believed only if that version exists for this project — so the
 * worst a forged value can do is fall back to the truth.
 */
async function resolveVersion(
  deps: AnalyticsIngestionDeps,
  projectId: string,
  activeVersionId: string,
  hint: string | undefined,
): Promise<string> {
  if (hint === undefined || hint === activeVersionId) return activeVersionId;

  const hinted = await deps.publishing.findActive(projectId, hint);
  return hinted === null ? activeVersionId : hinted.id;
}

/** The hostname the request is for, honouring the app's trust-proxy setting and nothing else. */
function hostnameOf(request: Request): string {
  return (request.hostname || request.headers.host || "").split(":")[0]?.toLowerCase() ?? "";
}
