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
import { BlogRepository, ensureBlogIndexes } from "./modules/blog/repository";
import { createBlogRouter, createPublicBlogRouter } from "./modules/blog/routes";
import { MediaRepository } from "./modules/media/repository";
import { createMediaRouter } from "./modules/media/routes";
import { createGridFsStorage } from "./modules/media/storage";
import { ProjectRepository } from "./modules/projects/repository";
import { createProjectsRouter } from "./modules/projects/routes";
import { WorkspaceRepository } from "./modules/workspaces/repository";
import { COLLECTIONS } from "./db/indexes";
import { hasPublishedTemplate } from "@websitebuilder/shared";
import { CmsRepository, ensureCmsIndexes } from "./modules/cms/repository";
import { createCmsRouter } from "./modules/cms/routes";
import { CloudflareHostnameProvider } from "./modules/domains/cloudflare";
import { FakeHostnameProvider } from "./modules/domains/fakeProvider";
import { DomainService } from "./modules/domains/service";
import type { CustomHostnameProvider } from "./modules/domains/provider";
import { createPublishingRouter } from "./modules/publishing/routes";
import { ensurePublishingIndexes, PublishingRepository } from "./modules/publishing/repository";
import { PublishingService } from "./modules/publishing/service";
import { createWorkspacesRouter } from "./modules/workspaces/routes";

/**
 * The custom-hostname provider.
 *
 * Without credentials the in-memory fake is used so development and tests never contact a paid API.
 * In production that would silently promise customers a domain nobody registered, so it is refused.
 */
function createHostnameProvider(env: Env, logger: ReturnType<typeof createLogger>): CustomHostnameProvider {
  if (!env.CLOUDFLARE_ZONE_ID || !env.CLOUDFLARE_API_TOKEN) {
    if (env.isProduction) throw new EnvironmentError(["CLOUDFLARE_ZONE_ID", "CLOUDFLARE_API_TOKEN"]);
    logger.warn("Cloudflare is not configured; custom domains use the in-memory fake provider");
    return new FakeHostnameProvider(env.PUBLIC_RENDERER_ORIGIN);
  }

  return new CloudflareHostnameProvider({
    apiBaseUrl: env.CLOUDFLARE_API_BASE_URL,
    zoneId: env.CLOUDFLARE_ZONE_ID,
    apiToken: env.CLOUDFLARE_API_TOKEN,
    originHostname: env.CLOUDFLARE_SAAS_CNAME_TARGET,
  });
}

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
  const blog = new BlogRepository(database.db);
  const cms = new CmsRepository(database.db);
  const publishing = new PublishingRepository(database.db, database.db.collection(COLLECTIONS.projects));
  const domains = new DomainService(database.db, createHostnameProvider(env, logger), env.PLATFORM_ROOT_DOMAIN);
  await ensureBlogIndexes(database.db);
  await ensurePublishingIndexes(database.db);
  await ensureCmsIndexes(database.db);

  // Better Auth owns its own routes and needs the raw body, so it is mounted before the JSON
  // parser rather than behind it.
  mountAuth = (app: express.Express) => {
    app.all(`${env.BETTER_AUTH_BASE_PATH}/*splat`, toNodeHandler(auth));
  };

  const collectModuleFacts = async ({ workspaceId, projectId }: { workspaceId: string; projectId: string }) => {
    const context = { workspaceId, userId: "" };
    const settings = await blog.loadSettings(context, projectId);
    const posts = await blog.list(context, projectId, { perPage: 1 });

    return {
      blog: {
        hasRecords: posts.total > 0,
        explicitlyActivated: settings.enabled,
        // A blog turned on with no article template yet cannot render its routes.
        blockingIssueCount: settings.enabled && settings.articleTemplateId === undefined ? 1 : 0,
        warningCount: 0,
      },
    };
  };

  routers.push(
    { path: "/me/preferences", router: createPreferencesRouter({ auth, preferences }) },
    { path: "/workspaces", router: createWorkspacesRouter({ auth, workspaces }) },
    { path: "/public/projects/:projectId/blog", router: createPublicBlogRouter({ repository: blog }) },
    {
      path: "/workspaces/:workspaceId/projects/:projectId/blog",
      router: createBlogRouter({
        repository: blog,
        resolveWorkspace: createWorkspaceResolver({ auth, workspaces, permission: "project:read" }),
      }),
    },
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
        // Facts come from each module's own records, never from the request.
        collectModuleFacts,
      }),
    },
    {
      path: "/workspaces/:workspaceId/projects/:projectId/cms",
      router: createCmsRouter({
        repository: cms,
        resolveWorkspace: createWorkspaceResolver({ auth, workspaces, permission: "project:read" }),
      }),
    },
    {
      path: "/workspaces/:workspaceId/projects/:projectId/publishing",
      router: createPublishingRouter({
        service: new PublishingService({
          projects,
          publishing,
          blog,
          media,
          collectModuleFacts,
          loadCmsCollections: async (context, projectId) => {
            const [collections, templates] = await Promise.all([
              cms.listCollections(context, projectId),
              cms.listTemplatesForProject(projectId),
            ]);
            const byCollection = new Map(templates.map((template) => [template.collectionId, template]));

            return collections.map((collection) => ({
              id: collection.id,
              name: collection.name,
              slug: collection.slug,
              fields: collection.fields,
              hasDetailRoute: collection.hasDetailRoute,
              hasPublishedTemplate: hasPublishedTemplate(byCollection.get(collection.id)),
            }));
          },
          loadCmsItems: async (_context, projectId) =>
            (await cms.listPublished(projectId)).map((item) => ({
              id: item.id,
              collectionId: item.collectionId,
              slug: item.slug,
              status: item.status,
              values: item.values,
              updatedAt: item.updatedAt,
            })),
          maxDocumentBytes: env.PUBLISH_MAX_DOCUMENT_BYTES,
          retentionCount: env.PUBLISHED_VERSION_RETENTION_COUNT,
        }),
        repository: publishing,
        domains,
        resolveWorkspace: createWorkspaceResolver({ auth, workspaces, permission: "project:read" }),
        platformRootDomain: env.PLATFORM_ROOT_DOMAIN,
        reservedSubdomains: env.reservedSubdomains,
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
