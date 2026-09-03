import { connectDatabase } from "./db/client";
import { COLLECTIONS } from "./db/indexes";
import { EnvironmentError, loadEnv } from "./config/env";
import type { Router } from "express";

import { createLogger } from "./config/logger";
import { listenOrExplain } from "./config/listen";
import { installGracefulShutdown } from "./lifecycle";
import { AnalyticsRepository, ensureAnalyticsIndexes, SiteViewRepository } from "./modules/analytics/repository";
import { ensurePublishingIndexes, PublishingRepository } from "./modules/publishing/repository";
import { ensureFormIndexes, FormRepository } from "./modules/forms/repository";
import { MediaRepository } from "./modules/media/repository";
import { createGridFsStorage } from "./modules/media/storage";
import { createAnalyticsRuntime } from "./renderer/analytics";
import { createFormSubmissionRouter } from "./renderer/forms";
import { createPublicMediaRouter } from "./renderer/media";
import { createRendererApp, type ViewRecorder } from "./renderer/app";
import { SiteResolver } from "./renderer/resolver";

async function start(): Promise<void> {
  let env;
  try {
    env = loadEnv(process.env, "renderer");
  } catch (error) {
    if (error instanceof EnvironmentError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger(env).child({ service: "public-renderer" });

  // Without a database there is nothing to serve, but health must still answer so the platform can
  // report the process as unhealthy rather than as missing.
  let resolver: SiteResolver | undefined;
  let recordView: ViewRecorder | undefined;
  let analytics: ReturnType<typeof createAnalyticsRuntime> | undefined;
  let formSubmissions: Router | undefined;
  let publicMedia: Router | undefined;
  if (env.MONGODB_URI && env.MONGODB_DB_NAME) {
    const database = await connectDatabase(env, logger);
    await ensurePublishingIndexes(database.db);
    await ensureAnalyticsIndexes(database.db);
    const publishing = new PublishingRepository(database.db, database.db.collection(COLLECTIONS.projects));
    resolver = new SiteResolver(publishing, env.PUBLIC_SITE_CACHE_TTL_SECONDS);

    analytics = createAnalyticsRuntime({
      resolver,
      analytics: new AnalyticsRepository(database.db),
      publishing,
      logger,
      settingsTtlSeconds: env.PUBLIC_SITE_CACHE_TTL_SECONDS,
      // Address-keyed limiting is only meaningful where a forwarded address can be believed.
      trustsProxy: env.trustedProxyCidrs.length > 0,
      // Off unless an operator says otherwise. Two locks in two places: this one, and each site's
      // own setting.
      enabled: env.ANALYTICS_INGESTION_ENABLED === "true",
      limits: {
        perAddress: env.ANALYTICS_RATE_LIMIT_PER_ADDRESS,
        perProject: env.ANALYTICS_RATE_LIMIT_PER_PROJECT,
        windowMs: 60_000,
      },
    });

    /*
     * Form submissions.
     *
     * No transactional email provider is connected, so nothing here promises delivery: a submission
     * is stored, and the Forms Center inbox is the source of truth — which is what the product tells
     * the customer beside the notification field. The adapter and its development sink stay in the
     * module for when a provider is chosen; wiring an empty one here would be a delivery path that
     * delivers nothing while looking like it does.
     */
    const formRepository = new FormRepository(database.db);
    await ensureFormIndexes(database.db);

    formSubmissions = createFormSubmissionRouter({
      resolver,
      forms: formRepository,
      logger,
      // Address-keyed limiting is only meaningful where a forwarded address can be believed.
      trustsProxy: env.trustedProxyCidrs.length > 0,
    });

    publicMedia = createPublicMediaRouter({
      resolver,
      media: new MediaRepository(database.db, createGridFsStorage(database.db)),
    });

    // Counting must never delay or fail a page. The response has already been decided by the time
    // this runs, and a failed counter is a logged warning — a site that stops rendering because its
    // statistics could not be written would be a bad trade for any customer.
    const views = new SiteViewRepository(database.db);
    recordView = (view) => {
      void views.record(view).catch((error: unknown) => {
        logger.warn({ err: error, projectId: view.projectId }, "could not record a page view");
      });
    };
  } else {
    logger.warn("MONGODB_URI is not set; the renderer cannot serve sites");
  }

  const app = createRendererApp({ env, logger, resolver, recordView, analytics, forms: formSubmissions, media: publicMedia });
  const server = listenOrExplain(app, {
    port: env.PUBLIC_RENDERER_PORT,
    variable: "PUBLIC_RENDERER_PORT",
    service: "The public renderer",
    logger,
    environment: env.NODE_ENV,
  });

  installGracefulShutdown({ server, logger, timeoutMs: env.SHUTDOWN_TIMEOUT_MS });
}

start().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
