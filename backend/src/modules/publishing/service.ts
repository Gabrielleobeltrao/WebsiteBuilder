import {
  compileSite,
  SCHEMA_VERSION,
  type CompileResult,
  type PublishableCmsItem,
  type PublishableCollection,
  type PublishedSiteVersion,
  type Redirect,
} from "@websitebuilder/shared";

import type { BlogRepository } from "../blog/repository";
import type { MediaRepository } from "../media/repository";
import type { ProjectRepository, WorkspaceContext } from "../projects/repository";
import { reconcileSiteStatus, type ModuleFacts } from "../projects/status";
import { PublishError, type PublishingRepository } from "./repository";

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
       * Workspace-scoped so a compiler run can never read another tenant's content. The redirect
       * store does not exist yet; its loader is wired in when it lands.
       */
      loadCmsCollections?: (context: WorkspaceContext, projectId: string) => Promise<PublishableCollection[]>;
      loadCmsItems?: (context: WorkspaceContext, projectId: string) => Promise<PublishableCmsItem[]>;
      loadRedirects?: (context: WorkspaceContext, projectId: string) => Promise<Redirect[]>;
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
      await this.deps.publishing.pruneVersions(context, projectId, this.deps.retentionCount ?? 20, version.id);

      return { status: "published", version, unchanged: false };
    } catch (error) {
      if (error instanceof PublishError && error.reason === "revision-changed") {
        return { status: "conflict", report: compiled.report };
      }
      throw error;
    }
  }

  private async compile(context: WorkspaceContext, projectId: string): Promise<CompileResult | null> {
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

    return compileSite({
      project,
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
      mediaExists: (mediaId) => ownedMedia.has(mediaId),
      supportedSchemaVersion: SCHEMA_VERSION,
      moduleBlockers: status.blockingIssueCount,
      maxDocumentBytes: this.deps.maxDocumentBytes ?? MAX_PUBLISHED_DOCUMENT_BYTES,
    });
  }
}
