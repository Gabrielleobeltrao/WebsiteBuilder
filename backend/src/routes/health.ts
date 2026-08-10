import { Router } from "express";

export type HealthStatus = { database: "up" | "down" | "not_configured" };

export type HealthProbe = () => Promise<HealthStatus> | HealthStatus;

const defaultProbe: HealthProbe = () => ({ database: "not_configured" });

/**
 * Reports whether the process can serve traffic. It exposes no tenant data and no configuration
 * values, so it is safe to leave reachable to the deployment platform's health checks.
 */
export function createHealthRouter(probe: HealthProbe = defaultProbe): Router {
  const router = Router();

  router.get("/", async (_req, res, next) => {
    try {
      const status = await probe();
      const healthy = status.database !== "down";
      res.status(healthy ? 200 : 503).json({
        data: {
          status: healthy ? "ok" : "degraded",
          uptimeSeconds: Math.floor(process.uptime()),
          database: status.database,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
