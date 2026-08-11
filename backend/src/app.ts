import { API_BASE_PATH } from "@websitebuilder/shared";
import cors from "cors";
import express, { type Express, type Router } from "express";
import { pinoHttp } from "pino-http";
import type { Logger } from "pino";

import { loadEnv, type Env } from "./config/env";
import { createLogger } from "./config/logger";
import { createErrorHandler, notFoundHandler } from "./middleware/errors";
import { createHealthRouter, type HealthProbe } from "./routes/health";

export type AppDependencies = {
  env?: Env;
  logger?: Logger;
  /** Reports database reachability. Phase 2 replaces the default with a real Mongo ping. */
  healthProbe?: HealthProbe;
  /** Feature routers mounted under the API base path. */
  routers?: Array<{ path: string; router: Router }>;
  /**
   * Mounts authentication routes. Called before the JSON body parser, because Better Auth reads
   * the raw request body itself.
   */
  mountAuth?: (app: Express) => void;
};

/**
 * Builds the API application without binding a port, so tests exercise the real middleware stack
 * over an ephemeral server instead of a hand-rolled mock.
 */
export function createApp(dependencies: AppDependencies = {}): Express {
  const env = dependencies.env ?? loadEnv();
  const logger = dependencies.logger ?? createLogger(env);

  const app = express();
  app.disable("x-powered-by");
  // Behind Coolify/Traefik the real client address arrives in a forwarded header. The exact proxy
  // chain is configured in Phase 18; trusting nothing by default is the safe starting point.
  app.set("trust proxy", false);

  app.use(pinoHttp({ logger, autoLogging: !env.isTest }));
  // Same-origin in production: the browser reaches this API through the gateway on the platform
  // origin, so no cross-origin request is expected and none is permitted. Development runs the two
  // on different ports, which is the only case that needs an allowance — and it is an exact origin,
  // never a reflection of whatever the request claimed.
  if (!env.isProduction) {
    app.use(cors({ origin: env.FRONTEND_ORIGIN, credentials: true }));
  }

  dependencies.mountAuth?.(app);

  app.use(express.json({ limit: env.JSON_BODY_LIMIT }));

  app.use(`${API_BASE_PATH}/health`, createHealthRouter(dependencies.healthProbe));
  for (const { path, router } of dependencies.routers ?? []) {
    app.use(`${API_BASE_PATH}${path}`, router);
  }

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  return app;
}
