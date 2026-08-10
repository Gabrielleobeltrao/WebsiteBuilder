import { toNodeHandler } from "better-auth/node";
import express from "express";

import { createApp, type AppDependencies } from "./app";
import { EnvironmentError, loadEnv, type Env } from "./config/env";
import { createLogger } from "./config/logger";
import { connectDatabase, createDatabaseHealthProbe, type Database } from "./db/client";
import { installGracefulShutdown } from "./lifecycle";
import { createWorkspaceResolver } from "./middleware/session";
import { createAuth } from "./modules/auth/auth";
import { PreferencesRepository } from "./modules/preferences/repository";
import { createPreferencesRouter } from "./modules/preferences/routes";
import { MediaRepository } from "./modules/media/repository";
import { createMediaRouter } from "./modules/media/routes";
import { createGridFsStorage } from "./modules/media/storage";
import { ProjectRepository } from "./modules/projects/repository";
import { createProjectsRouter } from "./modules/projects/routes";
import { WorkspaceRepository } from "./modules/workspaces/repository";
import { createWorkspacesRouter } from "./modules/workspaces/routes";

async function buildDependencies(env: Env, logger: ReturnType<typeof createLogger>) {
  const routers: NonNullable<AppDependencies["routers"]> = [];
  let database: Database | null = null;
  let mountAuth: AppDependencies["mountAuth"];

  if (!env.MONGODB_URI || !env.MONGODB_DB_NAME) {
    logger.warn("MONGODB_URI is not set; only health is served");
    return { database, routers, mountAuth };
  }

  database = await connectDatabase(env, logger);
  const auth = createAuth({ db: database.db, env });
  const workspaces = new WorkspaceRepository(database.db);
  const projects = new ProjectRepository(database.db);
  const preferences = new PreferencesRepository(database.db);
  const media = new MediaRepository(database.db, createGridFsStorage(database.db));

  // Better Auth owns its own routes and needs the raw body, so it is mounted before the JSON
  // parser rather than behind it.
  mountAuth = (app: express.Express) => {
    app.all(`${env.BETTER_AUTH_BASE_PATH}/*splat`, toNodeHandler(auth));
  };

  routers.push(
    { path: "/me/preferences", router: createPreferencesRouter({ auth, preferences }) },
    { path: "/workspaces", router: createWorkspacesRouter({ auth, workspaces }) },
    {
      path: "/workspaces/:workspaceId/media",
      router: createMediaRouter({
        repository: media,
        resolveWorkspace: createWorkspaceResolver({ auth, workspaces, permission: "media:read" }),
      }),
    },
    {
      path: "/workspaces/:workspaceId/projects",
      router: createProjectsRouter({
        repository: projects,
        // Read is the floor for reaching the router at all; each mutating route needs more, which
        // Phase 13 tightens per operation once the member management UI exists.
        resolveWorkspace: createWorkspaceResolver({ auth, workspaces, permission: "project:read" }),
      }),
    },
  );

  return { database, routers, mountAuth };
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
  const { database, routers, mountAuth } = await buildDependencies(env, logger);

  const app = createApp({
    env,
    logger,
    routers,
    ...(mountAuth ? { mountAuth } : {}),
    healthProbe: createDatabaseHealthProbe(database),
  });

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
