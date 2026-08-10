import express, { type Express } from "express";
import { pinoHttp } from "pino-http";
import type { Logger } from "pino";

import type { Env } from "../config/env";

/**
 * The public multi-tenant renderer. One stateless process serves every published site: it resolves
 * the request hostname to an active domain record, never a client-supplied project ID, and answers
 * an unrecognised host with a neutral response that reveals no tenant.
 *
 * Phase 18 adds host resolution, the snapshot cache and server-rendered route HTML. Until then it
 * exposes only the health endpoint the deployment platform needs.
 */
export function createRendererApp(options: { env: Env; logger: Logger }): Express {
  const { env, logger } = options;

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use(pinoHttp({ logger, autoLogging: !env.isTest }));

  // Health must not require a site hostname and must not expose tenant data.
  app.get("/healthz", (_req, res) => {
    res.status(200).json({ data: { status: "ok", uptimeSeconds: Math.floor(process.uptime()) } });
  });

  app.use((_req, res) => {
    res.status(404).type("text/plain").send("Not found");
  });

  return app;
}
