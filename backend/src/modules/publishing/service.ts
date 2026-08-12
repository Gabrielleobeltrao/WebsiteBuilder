import {
  buildRouteManifest,
  compileSite,
  migrateDocumentElements,
  migrateDocumentResponsive,
  SCHEMA_VERSION,
  type CompileInput,
  type CompileResult,
  type PublishableCmsItem,
  type PublishableCollection,
  type PublishableForm,
  type PublishedSiteVersion,
  type Redirect,
} from "@websitebuilder/shared";

import { renderRouteHtml } from "../../renderer/html";
import type { BlogRepository } from "../blog/repository";
import type { MediaRepository } from "../media/repository";
import type { ProjectRepository, WorkspaceContext } from "../projects/repository";
import { reconcileSiteStatus, type ModuleFacts } from "../projects/status";
import { PublishError, type PublishingRepository } from "./repository";

/** What a draft preview answers with for a path the site does not serve. */
const NOT_FOUND_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found</title></head>' +
  "<body><p>This page is not part of the site.</p></body></html>";

/** A published document larger than this is a symptom, not a site. Overridable per environment. */
export const MAX_PUBLISHED_DOCUMENT_BYTES = 4_000_000;

export type PublishOutcome =
  | { status: "published"; version: PublishedSiteVersion; unchanged: boolean }
  | { status: "blocked"; report: CompileResult["report"] }
  | { status: "conflict"; report: CompileResult["report"] }
  | { status: "not-found" };

/**
 * Turns a saved project into a live site.
 *
 * Compilation reads one revision, and the repository's pointer swap is conditioned on that same
 * revision. Anything saved while the snapshot was being built therefore fails the swap instead of
 * publishing a mixture of two revisions.
 */
export class PublishingService {
  constructor(
    private readonly deps: {
      projects: ProjectRepository;
      publishing: PublishingRepository;
      blog: BlogRepository;
      media: MediaRepository;
      maxDocumentBytes?: number;
      /** Versions kept per project. The active one is never pruned regardless of this number. */
      retentionCount?: number;
      /**
       * The root domain every project's free subdomain hangs off, and the labels it may not use.
       *
       * Publishing without them still moves the pointer and still leaves the site unreachable,
       * which is what happened before: `publish` meant "compile and swap" while a customer read it
       * as "put my site online", and nothing in the product ever created the address.
       */
      platformRootDomain?: string;
      reservedSubdomains?: readonly string[];
      /**
       * Called with the versions retention just deleted.
       *
       * Injected rather than imported so publishing keeps no dependency on analytics — it does not
       * need to know why a layout mattered to anyone else, only that it is gone.
       */
      onVersionsPruned?: (context: WorkspaceContext, projectId: string, versionIds: string[]) => Promise<void>;
      /**
       * Workspace-scoped so a compiler run can never read another tenant's content. The redirect
       * store does not exist yet; its loader is wired in when it lands.
       */
      loadCmsCollections?: (context: WorkspaceContext, projectId: string) => Promise<PublishableCollection[]>;
      loadCmsItems?: (context: WorkspaceContext, projectId: string) => Promise<PublishableCmsItem[]>;
      loadRedirects?: (context: WorkspaceContext, projectId: string) => Promise<Redirect[]>;
      /** Form definitions, so a published page can render the fields its blocks reference. */
      loadForms?: (context: WorkspaceContext, projectId: string) => Promise<PublishableForm[]>;
      collectModuleFacts?: (input: {
        workspaceId: string;
        projectId: string;
      }) => Promise<Partial<Record<"forms" | "blog" | "cms" | "search", ModuleFacts>>>;
    },
  ) {}

  /** Compiles without publishing, so the editor can show what would block before anything changes. */
  async preflight(context: WorkspaceContext, projectId: string): Promise<CompileResult | null> {
    const compiled = await this.compile(context, projectId);
    return compiled;
  }

  async publish(context: WorkspaceContext, projectId: string): Promise<PublishOutcome> {
    const compiled = await this.compile(context, projectId);
    if (compiled === null) return { status: "not-found" };
    if (!compiled.ok) return { status: "blocked", report: compiled.report };

    const { snapshot } = compiled;
    // Republishing identical content is not an error, but it also should not create a version
    // nobody can tell apart from the last one.
    const active = await this.deps.publishing.findActiveForProject(projectId);
    if (active !== null && active.contentHash === snapshot.contentHash) {
      // Republishing unchanged content is how someone whose site never got an address tries again,
      // so this path has to be able to give them one.
      await this.ensurePublicAddress(context, projectId);
      return { status: "published", version: active, unchanged: true };
    }

    try {
      const version = await this.deps.publishing.publish(context, projectId, {
        sourceRevision: snapshot.sourceRevision,
        schemaVersion: snapshot.schemaVersion,
        document: snapshot.document,
        routes: snapshot.routes,
        redirects: snapshot.redirects,
        referencedMediaIds: snapshot.referencedMediaIds,
        contentHash: snapshot.contentHash,
      });
      // Retention runs after the pointer moved, so the version now live is known and excluded.
      // Deleting the snapshot a site is serving to save disk would take that site offline.
      const pruned = await this.deps.publishing.pruneVersions(
        context,
        projectId,
        this.deps.retentionCount ?? 20,
        version.id,
      );

      // Anything else that describes those layouts goes with them — today, the heatmap coordinates
      // that would otherwise have nothing to be drawn over. Awaited so a caller sees a consistent
      // state, and swallowed so it cannot fail a publish: a site that would not go live because its
      // old statistics could not be tidied is a bad trade in every direction.
      if (pruned.length > 0 && this.deps.onVersionsPruned !== undefined) {
        await this.deps.onVersionsPruned(context, projectId, pruned).catch(() => undefined);
      }

      await this.ensurePublicAddress(context, projectId);

      return { status: "published", version, unchanged: false };
    } catch (error) {
      if (error instanceof PublishError && error.reason === "revision-changed") {
        return { status: "conflict", report: compiled.report };
      }
      throw error;
    }
  }

  /**
   * Gives a published site the address it is served on.
   *
   * A published version with nowhere to serve it is not published in the sense anyone means, and
   * that is exactly what used to happen: `publish` compiled and swapped a pointer while a customer
   * read it as "put my site online", and nothing in the product ever created the hostname. The
   * platform subdomain is free, derived from the slug, and needs no decision from anybody.
   *
   * Non-fatal by construction. A slug that is reserved or already taken leaves the site without an
   * address — which the publishing screen reports — and is not a reason to fail a publish that has
   * already succeeded.
   */
  private async ensurePublicAddress(context: WorkspaceContext, projectId: string): Promise<void> {
    if (this.deps.platformRootDomain === undefined) return;

    const project = await this.deps.projects.findById(context, projectId);
    if (project === null) return;

    await this.deps.publishing
      .ensurePlatformDomain(
        context,
        projectId,
        project.slug,
        this.deps.platformRootDomain,
        this.deps.reservedSubdomains,
      )
      .catch(() => null);
  }

  /**
   * One page of the current draft, as the HTML a visitor would receive.
   *
   * The same document, the same route manifest and the same renderer publication uses — which is
   * what makes preview a rehearsal rather than a second implementation with its own bugs. It reads
   * the draft, so it shows unsaved-to-the-public work, and it writes nothing.
   *
   * Deliberately independent of whether the site *can* be published: a draft with a blocking issue
   * is exactly the draft somebody needs to look at.
   */
  async previewRoute(
    context: WorkspaceContext,
    projectId: string,
    input: {
      path: string;
      pageHref: (path: string) => string;
      mediaBaseUrl: string;
      canonicalOrigin: string;
      runtimeSrc?: string;
    },
  ): Promise<{ html: string; status: 200 | 404 } | null> {
    const compileInput = await this.buildCompileInput(context, projectId);
    if (compileInput === null) return null;

    const routes = buildRouteManifest(compileInput);
    const route = routes.find((candidate) => candidate.path === input.path && candidate.statusCode === 200);
    if (route === undefined) return { html: NOT_FOUND_HTML, status: 404 };

    return {
      status: 200,
      html: renderRouteHtml({
        route,
        document: compileInput.project,
        canonicalUrl: `${input.canonicalOrigin}${input.path}`,
        mediaBaseUrl: input.mediaBaseUrl,
        pageHref: input.pageHref,
        // The same runtime the published page gets, so a preview rehearses the behaviour rather
        // than a static approximation of it.
        ...(input.runtimeSrc === undefined ? {} : { runtimeSrc: input.runtimeSrc }),
      }),
    };
  }

  private async compile(context: WorkspaceContext, projectId: string): Promise<CompileResult | null> {
    const input = await this.buildCompileInput(context, projectId);
    return input === null ? null : compileSite(input);
  }

  /** Everything the compiler needs, gathered once and scoped to the workspace throughout. */
  private async buildCompileInput(context: WorkspaceContext, projectId: string): Promise<CompileInput | null> {
    const project = await this.deps.projects.findById(context, projectId);
    if (project === null) return null;

    const [settings, posts, media, collections, items, redirects, facts] = await Promise.all([
      this.deps.blog.loadSettings(context, projectId),
      this.deps.blog.list(context, projectId, { perPage: 500 }),
      this.deps.media.list(context, 1000),
      this.deps.loadCmsCollections?.(context, projectId) ?? Promise.resolve([]),
      this.deps.loadCmsItems?.(context, projectId) ?? Promise.resolve([]),
      this.deps.loadRedirects?.(context, projectId) ?? Promise.resolve([]),
      this.deps.collectModuleFacts?.({ workspaceId: context.workspaceId, projectId }) ?? Promise.resolve({}),
    ]);

    // Ownership comes from the workspace's own media list, so a snapshot can never reference an
    // asset belonging to another tenant even if the document names its id.
    const ownedMedia = new Set(media.map((asset) => asset.id));

    const status = reconcileSiteStatus({ project, facts });

    // The same migration the builder applies when a draft is opened. Publishing must not depend on
    // somebody having opened the editor first: a site published straight from an old document would
    // otherwise go live with the layout this whole model exists to prevent.
    // The same two migrations the builder applies on read. Publishing must not depend on somebody
    // having opened the editor first.
    const { document: versioned } = migrateDocumentElements(project);
    const { document: migrated } = migrateDocumentResponsive(versioned);

    return {
      project: migrated,
      blog: {
        settings,
        posts: posts.items.map((post) => ({
          id: post.id,
          slug: post.slug,
          title: post.title,
          excerpt: post.excerpt,
          status: post.status,
          coverMediaId: post.coverMediaId,
          updatedAt: post.updatedAt,
          seo: { title: post.seoTitle, description: post.seoDescription },
        })),
      },
      cms: { collections, items },
      redirects,
      // Only the definitions this project owns; the compiler keeps the ones its pages reference.
      forms: (await this.deps.loadForms?.(context, projectId)) ?? [],
      mediaExists: (mediaId) => ownedMedia.has(mediaId),
      supportedSchemaVersion: SCHEMA_VERSION,
      moduleBlockers: status.blockingIssueCount,
      maxDocumentBytes: this.deps.maxDocumentBytes ?? MAX_PUBLISHED_DOCUMENT_BYTES,
    };
  }
}
