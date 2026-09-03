import { toNodeHandler } from "better-auth/node";
import express from "express";

import { createApp, type AppDependencies } from "./app";
import { EnvironmentError, loadEnv, presentVariables, type Env } from "./config/env";
import { createLogger } from "./config/logger";
import { listenOrExplain } from "./config/listen";
import { connectDatabase, createDatabaseHealthProbe, type Database } from "./db/client";
import { installGracefulShutdown } from "./lifecycle";
import { createWorkspaceResolver } from "./middleware/session";
import { AnalyticsQueries } from "./modules/analytics/queries";
import { AnalyticsRepository, ensureAnalyticsIndexes } from "./modules/analytics/repository";
import { createAnalyticsRouter } from "./modules/analytics/routes";
import { createAuth } from "./modules/auth/auth";
import { PreferencesRepository } from "./modules/preferences/repository";
import { createPreferencesRouter } from "./modules/preferences/routes";
import { BlogRepository, ensureBlogIndexes } from "./modules/blog/repository";
import { ensureTemplateIndexes, TemplateRepository } from "./modules/blog/templates";
import { createBlogRouter, createPublicBlogRouter } from "./modules/blog/routes";
import { MediaRepository } from "./modules/media/repository";
import { createMediaRouter } from "./modules/media/routes";
import { createGridFsStorage } from "./modules/media/storage";
import { ProjectRepository } from "./modules/projects/repository";
import { attachCardSummaries } from "./modules/projects/summaries";
import { createProjectsRouter } from "./modules/projects/routes";
import { WorkspaceRepository } from "./modules/workspaces/repository";
import { COLLECTIONS } from "./db/indexes";
import { blogSetupIssues, countUnboundFormBlocks, findFormUsages, hasPublishedTemplate, type BuilderProject } from "@websitebuilder/shared";
import { CmsRepository, ensureCmsIndexes } from "./modules/cms/repository";
import { createCmsRouter } from "./modules/cms/routes";
import { CloudflareHostnameProvider } from "./modules/domains/cloudflare";
import { FakeHostnameProvider } from "./modules/domains/fakeProvider";
import { UnconfiguredHostnameProvider } from "./modules/domains/unconfiguredProvider";
import { DomainService } from "./modules/domains/service";
import type { CustomHostnameProvider } from "./modules/domains/provider";
import { createFormsRouter } from "./modules/forms/routes";
import { FormRepository, ensureFormIndexes } from "./modules/forms/repository";
import { createPublishingRouter } from "./modules/publishing/routes";
import { ensurePublishingIndexes, PublishingRepository } from "./modules/publishing/repository";
import { PublishingService } from "./modules/publishing/service";
import { createWorkspaceDashboardRouter, createWorkspacesRouter } from "./modules/workspaces/routes";

/**
 * The custom-hostname provider.
 *
 * Without credentials the in-memory fake is used so development and tests never contact a paid API.
 * In production that would silently promise customers a domain nobody registered, so it is refused.
 */
function createHostnameProvider(env: Env, logger: ReturnType<typeof createLogger>): CustomHostnameProvider {
  if (!env.CLOUDFLARE_ZONE_ID || !env.CLOUDFLARE_API_TOKEN) {
    // In production the platform still runs: sites publish and serve on their platform hostnames,
    // and only connecting a customer's own domain is refused. Refusing at start-up instead would
    // take down everything over a feature nobody may be using yet. What must never happen is the
    // in-memory fake answering successfully in production and promising a domain nobody registered.
    if (env.isProduction) {
      logger.warn(
        "Cloudflare is not configured; connecting a customer domain will be refused until it is",
      );
      return new UnconfiguredHostnameProvider();
    }

    logger.warn("Cloudflare is not configured; custom domains use the in-memory fake provider");
    return new FakeHostnameProvider(env.PUBLIC_RENDERER_HOST);
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
  const blogTemplates = new TemplateRepository(database.db);
  const forms = new FormRepository(database.db);
  const cms = new CmsRepository(database.db);
  const publishing = new PublishingRepository(database.db, database.db.collection(COLLECTIONS.projects));
  const analytics = new AnalyticsRepository(database.db);
  const domains = new DomainService(database.db, createHostnameProvider(env, logger), env.PLATFORM_ROOT_DOMAIN);
  await ensureBlogIndexes(database.db);
  await ensureTemplateIndexes(database.db);
  await ensureFormIndexes(database.db);
  await ensurePublishingIndexes(database.db);
  await ensureCmsIndexes(database.db);
  await ensureAnalyticsIndexes(database.db);

  // Better Auth owns its own routes and needs the raw body, so it is mounted before the JSON
  // parser rather than behind it.
  mountAuth = (app: express.Express) => {
    app.all(`${env.BETTER_AUTH_BASE_PATH}/*splat`, toNodeHandler(auth));
  };

  const collectModuleFacts = async ({ workspaceId, projectId }: { workspaceId: string; projectId: string }) => {
    const context = { workspaceId, userId: "" };
    const [settings, posts, formDefinitions, formRecords, project] = await Promise.all([
      blog.loadSettings(context, projectId),
      blog.list(context, projectId, { perPage: 1 }),
      forms.list(context, projectId),
      forms.hasRecords(context, projectId),
      projects.findById(context, projectId),
    ]);

    /*
     * Form facts, from the module's own records and the saved document.
     *
     * A block bound to nothing, or bound to a definition that is gone, archived or unfinished, is a
     * page that would publish as a set of inputs taking an answer nobody receives. Counted here so
     * the site status center, the navigation badge and publication all read one number.
     */
    const byId = new Map(formDefinitions.map((definition) => [definition.id, definition]));
    const placements = project === null ? [] : findFormUsages(project);
    const unbound = project === null ? 0 : countUnboundFormBlocks(project);

    const brokenPlacements = placements.filter((usage) => {
      const definition = byId.get(usage.formId);
      return definition === undefined || definition.archived || definition.status !== "ready";
    }).length;

    return {
      blog: {
        hasRecords: posts.total > 0,
        explicitlyActivated: settings.enabled,
        // A blog that cannot serve the routes it publishes. Counted from the shared rule so the
        // activation screen, the status centre and publication all agree on what "ready" means.
        blockingIssueCount: blogSetupIssues(settings).length,
        warningCount: 0,
      },
      forms: {
        hasRecords: formRecords,
        // There is no switch to turn forms on: a definition exists because somebody made one, and
        // that is the same statement of intent as placing a block.
        explicitlyActivated: formDefinitions.length > 0,
        blockingIssueCount: unbound + brokenPlacements,
        // A definition nobody shows is not a problem; it is a form waiting for a page.
        warningCount: formDefinitions.filter(
          (definition) => !definition.archived && !placements.some((usage) => usage.formId === definition.id),
        ).length,
      },
    };
  };

  routers.push(
    { path: "/me/preferences", router: createPreferencesRouter({ auth, preferences }) },
    { path: "/workspaces", router: createWorkspacesRouter({ auth, workspaces }) },
    {
      path: "/workspaces/:workspaceId/dashboard",
      router: createWorkspaceDashboardRouter({
        db: database.db,
        resolveWorkspace: createWorkspaceResolver({ auth, workspaces, permission: "project:read" }),
      }),
    },
    { path: "/public/projects/:projectId/blog", router: createPublicBlogRouter({ repository: blog }) },
    {
      path: "/workspaces/:workspaceId/projects/:projectId/blog",
      router: createBlogRouter({
        repository: blog,
        templates: blogTemplates,
        resolveWorkspace: createWorkspaceResolver({ auth, workspaces, permission: "project:read" }),
      }),
    },
    {
      /*
       * Mounted under a project, because a library belongs to the site it is for.
       *
       * The workspace-level path stays as well, and returns everything: publishing and any tool
       * that reasons about a tenant's bytes still needs the whole set, and an address that used to
       * work must not start answering with a subset of what it used to.
       */
      path: "/workspaces/:workspaceId/projects/:projectId/media",
      router: createMediaRouter({
        repository: media,
        resolveWorkspace: createWorkspaceResolver({ auth, workspaces, permission: "media:read" }),
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
        attachCardSummaries: (context, list) => attachCardSummaries(database.db, context, list),
        // Read is the floor for reaching the router at all; each mutating route needs more, which
        // Phase 13 tightens per operation once the member management UI exists.
        resolveWorkspace: createWorkspaceResolver({ auth, workspaces, permission: "project:read" }),
        // Facts come from each module's own records, never from the request.
        collectModuleFacts,
        // Readiness needs both to be truthful: what media this tenant owns, and which revision the
        // public snapshot was compiled from.
        loadOwnedMediaIds: async ({ workspaceId }) =>
          new Set((await media.list({ workspaceId, userId: "" }, undefined, 1000)).map((asset) => asset.id)),
        loadActiveSourceRevision: async ({ workspaceId, projectId }) => {
          const active = await publishing.findActiveForProject(projectId);
          return active === null || active.workspaceId !== workspaceId ? null : active.sourceRevision;
        },
        // Scoped twice: the caller's workspace is verified by the resolver, and the snapshot is
        // used only when it belongs to that same workspace.
        loadPublishedDocument: async ({ workspaceId, projectId }) => {
          const active = await publishing.findActiveForProject(projectId);
          return active === null || active.workspaceId !== workspaceId ? null : (active.document as BuilderProject);
        },
      }),
    },
    {
      path: "/workspaces/:workspaceId/projects/:projectId/analytics",
      router: createAnalyticsRouter({
        repository: analytics,
        queries: new AnalyticsQueries(database.db, async (context, projectId) => {
          // Page identifiers come from the published manifest, which is also the only place that
          // knows what path each one answers on. A page deleted since keeps its history and loses
          // its name rather than being given an invented one.
          const version = await publishing.findActiveForProject(projectId);
          if (version === null || version.workspaceId !== context.workspaceId) return new Map();
          return new Map(version.routes.map((route) => [route.resourceId, route.path]));
        },
        // Scoped by the caller's workspace inside the query itself; this only loads.
        async (projectId, versionId) => publishing.findActive(projectId, versionId)),
        resolveWorkspace: createWorkspaceResolver({ auth, workspaces, permission: "project:read" }),
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
      path: "/workspaces/:workspaceId/projects/:projectId/forms",
      router: createFormsRouter({
        repository: forms,
        resolveWorkspace: createWorkspaceResolver({ auth, workspaces, permission: "project:read" }),
        // Placement is a fact about the saved document, and the document is scoped by the same
        // verified workspace the resolver produced.
        loadProject: ({ workspaceId, userId, projectId }) => projects.findById({ workspaceId, userId }, projectId),
        loadPublishedRevisions: async ({ workspaceId, projectId }) => {
          const active = await publishing.findActiveForProject(projectId);
          if (active === null || active.workspaceId !== workspaceId) return new Map();
          return new Map((active.forms ?? []).map((form) => [form.id, form.revision]));
        },
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
          // Exactly what a published page needs, and nothing operational: notification recipients
          // and retention are the customer's settings, not something public output should carry.
          // The two pages the blog's routes render through, as the templates module stores them.
          loadBlogTemplates: async (context, projectId) => {
            const settings = await blog.loadSettings(context, projectId);
            if (!settings.enabled) return {};

            const [index, article] = await Promise.all([
              blogTemplates.loadOrCreate(context, projectId, "index"),
              blogTemplates.loadOrCreate(context, projectId, "article"),
            ]);
            // The published document, never the draft: editing a template changes the live site at
            // the next publish and not before.
            return {
              ...(index.publishedDocument === undefined ? {} : { index: index.publishedDocument }),
              ...(article.publishedDocument === undefined ? {} : { article: article.publishedDocument }),
              // As of the last publication, matching the documents above: a definition renamed
              // since then must not change what an already-published article resolves.
              fieldDefinitions: article.publishedFieldDefinitions,
            };
          },
          // The drafts, for previewing a layout that has not been published yet.
          loadBlogTemplateDrafts: async (context, projectId) => {
            const [index, article] = await Promise.all([
              blogTemplates.loadOrCreate(context, projectId, "index"),
              blogTemplates.loadOrCreate(context, projectId, "article"),
            ]);
            return { index: index.draftDocument, article: article.draftDocument };
          },
          loadForms: async (context, projectId) =>
            (await forms.list(context, projectId)).map((form) => ({
              id: form.id,
              name: form.name,
              revision: form.revision,
              fields: form.fields,
              submitLabel: form.submitLabel,
              successBehavior: form.successBehavior,
              ...(form.errorMessage === undefined ? {} : { errorMessage: form.errorMessage }),
              status: form.archived ? ("archived" as const) : form.status,
            })),
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
          // Publishing gives the site the address it is served on. Without this, a customer
          // publishes successfully and their site is still reachable from nowhere.
          platformRootDomain: env.PLATFORM_ROOT_DOMAIN,
          reservedSubdomains: env.reservedSubdomains,
          // Heatmap coordinates are meaningless without the layout that produced them, so they are
          // deleted by the same operation that deletes the layout.
          onVersionsPruned: async (context, projectId, versionIds) => {
            await analytics.dropVersionData(context, projectId, versionIds);
          },
        }),
        repository: publishing,
        domains,
        resolveWorkspace: createWorkspaceResolver({ auth, workspaces, permission: "project:read" }),
        platformRootDomain: env.PLATFORM_ROOT_DOMAIN,
        reservedSubdomains: env.reservedSubdomains,
        publicOrigin: env.PLATFORM_PUBLIC_ORIGIN,
      }),
    },
  );

  return { database, routers, mountAuth };
}

async function start(): Promise<void> {
  let env: Env;
  try {
    env = loadEnv(process.env, "api");
  } catch (error) {
    if (error instanceof EnvironmentError) {
      // Listing what did arrive turns one ambiguous failure into two distinguishable ones: nothing
      // here means the platform passed no environment at all, which is a different fix from a
      // single variable that was never saved. Names only — a value printed here is a value leaked
      // into every log collector downstream.
      const present = presentVariables();
      process.stderr.write(
        `${error.message}\n\nVariables this service received: ${present.length === 0 ? "(none)" : present.join(", ")}\n`,
      );
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

  const server = listenOrExplain(app, {
    port: env.API_PORT,
    variable: "API_PORT",
    service: "The API",
    logger,
    environment: env.NODE_ENV,
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
