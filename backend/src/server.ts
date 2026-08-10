import { createApp, type AppDependencies } from "./app";
import { EnvironmentError, loadEnv, type Env } from "./config/env";
import { createLogger } from "./config/logger";
import { connectDatabase, createDatabaseHealthProbe, type Database } from "./db/client";
import { installGracefulShutdown } from "./lifecycle";
import { createSeededWorkspaceResolver } from "./middleware/workspace";
import { ProjectRepository } from "./modules/projects/repository";
import { createProjectsRouter } from "./modules/projects/routes";

/**
 * Development workspace used until Phase 7 installs Better Auth sessions and organization
 * membership. It is explicit and seeded, never an unscoped fallback, and production refuses to
 * start with it.
 */
const DEVELOPMENT_WORKSPACE = { workspaceId: "development-workspace", userId: "development-user" };

async function buildDependencies(env: Env, logger: ReturnType<typeof createLogger>) {
  let database: Database | null = null;
  const routers: NonNullable<AppDependencies["routers"]> = [];

  if (env.MONGODB_URI && env.MONGODB_DB_NAME) {
    database = await connectDatabase(env, logger);
    if (env.isProduction) {
      // Phase 7 replaces this with the real session resolver. Shipping the seeded one would give
      // every visitor the same workspace, so production must not reach here.
      throw new Error("Authentication is not configured yet; refusing to serve business routes in production");
    }
    routers.push({
      path: "/workspaces/:workspaceId/projects",
      router: createProjectsRouter({
        repository: new ProjectRepository(database.db),
        resolveWorkspace: createSeededWorkspaceResolver(DEVELOPMENT_WORKSPACE),
      }),
    });
    logger.warn({ workspace: DEVELOPMENT_WORKSPACE.workspaceId }, "serving business routes with a seeded workspace");
  } else {
    logger.warn("MONGODB_URI is not set; only health is served");
  }

  return { database, routers };
}

async function start(): Promise<void> {
  let env: Env;
  try {
    env = loadEnv();
  } catch (error) {
    if (error instanceof EnvironmentError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger(env);
  const { database, routers } = await buildDependencies(env, logger);

  const app = createApp({ env, logger, routers, healthProbe: createDatabaseHealthProbe(database) });
  const server = app.listen(env.API_PORT, () => {
    logger.info({ port: env.API_PORT, env: env.NODE_ENV }, "API listening");
  });

  installGracefulShutdown({
    server,
    logger,
    timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    onShutdown: async () => {
      await database?.close();
    },
  });
}

void start().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
