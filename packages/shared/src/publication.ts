import { postPath, type BlogSettings } from "./blog";
import { normalizeCollectionSlug, type CmsCollectionInput, type CmsItemStatus } from "./cms";
import { walkElements } from "./elements";
import { pagePath, type BuilderProject } from "./project";
import {
  contentHash,
  preflight,
  type PreflightReport,
  type PublishedRedirect,
  type RouteManifestEntry,
} from "./publishing";
import { flattenChains, type Redirect } from "./redirects";
import { buildSearchIndex, type SearchDocument, type SearchSource } from "./search";
import { resolvePageMetadata } from "./seo";

/**
 * Compiles one project revision into a publishable snapshot.
 *
 * The whole function is pure: every input is passed in, nothing is read from a clock, a database or
 * a random source. That is what makes the acceptance criterion checkable — the same revision must
 * produce the same content hash, so "did anything actually change?" is answered rather than
 * guessed, and a rebuild can be compared against what is already live.
 *
 * It also either produces a complete snapshot or produces none. There is no partial result to
 * publish, which is what keeps a failed build from degrading a running site.
 */

export type PublishablePost = {
  id: string;
  slug: string;
  title: string;
  excerpt?: string;
  status: "draft" | "published";
  coverMediaId?: string;
  updatedAt: string;
  seo?: { title?: string; description?: string };
};

export type PublishableCmsItem = {
  id: string;
  collectionId: string;
  slug: string;
  status: CmsItemStatus;
  values: Record<string, unknown>;
  updatedAt: string;
};

export type PublishableCollection = CmsCollectionInput & {
  id: string;
  /** A collection without a detail route holds data used by list elements only. */
  hasDetailRoute: boolean;
  /**
   * Item routes exist only once the collection's template has been published. Emitting them
   * earlier would publish paths that resolve to nothing a designer ever approved.
   */
  hasPublishedTemplate: boolean;
};

export type CompileInput = {
  project: BuilderProject;
  blog: { settings: BlogSettings; posts: readonly PublishablePost[] };
  cms: { collections: readonly PublishableCollection[]; items: readonly PublishableCmsItem[] };
  redirects: readonly Redirect[];
  /** Media ids the workspace actually owns. Ownership is decided by the caller, never inferred. */
  mediaExists: (mediaId: string) => boolean;
  supportedSchemaVersion: number;
  /** Blocking issues from the Site status center, already reconciled from source records. */
  moduleBlockers: number;
  maxDocumentBytes: number;
};

export type CompiledSnapshot = {
  sourceRevision: number;
  schemaVersion: number;
  document: BuilderProject;
  routes: RouteManifestEntry[];
  redirects: PublishedRedirect[];
  referencedMediaIds: string[];
  searchIndex: SearchDocument[];
  sitemapPaths: string[];
  contentHash: string;
};

export type CompileResult =
  | { ok: true; snapshot: CompiledSnapshot; report: PreflightReport }
  | { ok: false; snapshot: null; report: PreflightReport };

export function compileSite(input: CompileInput): CompileResult {
  const routes = buildRouteManifest(input);
  const referencedMediaIds = collectMediaIds(input);
  const redirects = compileRedirects(input.redirects, routes);

  const document = input.project;
  const documentBytes = JSON.stringify(document).length;

  const report = preflight({
    sourceRevision: input.project.revision,
    routes,
    referencedMediaIds,
    mediaExists: input.mediaExists,
    schemaVersion: input.project.schemaVersion,
    supportedSchemaVersion: input.supportedSchemaVersion,
    moduleBlockers: input.moduleBlockers,
    documentBytes,
    maxDocumentBytes: input.maxDocumentBytes,
  });

  if (report.blocked) return { ok: false, snapshot: null, report };

  const snapshot: CompiledSnapshot = {
    sourceRevision: input.project.revision,
    schemaVersion: input.project.schemaVersion,
    document,
    routes,
    redirects,
    referencedMediaIds,
    searchIndex: buildSearchIndex(collectSearchSources(input, routes)),
    // Only indexable routes belong in a sitemap; a 404 route is not a destination.
    sitemapPaths: routes.filter(isIndexable).map((route) => route.path),
    contentHash: contentHash({ document: normalizeForHash(document), routes, redirects }),
  };

  return { ok: true, snapshot, report };
}

/**
 * Every public path the site answers on.
 *
 * Drafts are absent rather than filtered later: an unpublished post has no route, so no snapshot
 * can accidentally expose one.
 */
export function buildRouteManifest(input: CompileInput): RouteManifestEntry[] {
  const routes: RouteManifestEntry[] = [];

  for (const page of [...input.project.pages].sort((a, b) => a.order - b.order)) {
    routes.push({
      path: pagePath(page),
      kind: "page",
      resourceId: page.id,
      statusCode: 200,
      seo: { ...resolvePageMetadata({ page: page.seo, site: input.project.seo, pageName: page.name }) },
    });
  }

  if (input.blog.settings.enabled) {
    routes.push({
      path: input.blog.settings.basePath,
      kind: "blogIndex",
      resourceId: "blog-index",
      statusCode: 200,
      seo: { title: input.project.seo.siteName, description: input.project.seo.defaultDescription },
    });

    for (const post of publishedOnly(input.blog.posts)) {
      routes.push({
        path: postPath(input.blog.settings.basePath, post.slug),
        kind: "blogPost",
        resourceId: post.id,
        statusCode: 200,
        seo: {
          title: post.seo?.title ?? post.title,
          description: post.seo?.description ?? post.excerpt ?? "",
        },
      });
    }
  }

  for (const collection of input.cms.collections) {
    if (!collection.hasDetailRoute) continue;
    const base = `/${normalizeCollectionSlug(collection.slug)}`;

    routes.push({
      path: base,
      kind: "cmsList",
      resourceId: collection.id,
      statusCode: 200,
      seo: { title: collection.name },
    });

    // No published template means no page to render an item with, so no item route is claimed.
    if (!collection.hasPublishedTemplate) continue;

    for (const item of input.cms.items) {
      if (item.collectionId !== collection.id || item.status !== "published") continue;
      routes.push({
        path: `${base}/${item.slug}`,
        kind: "cmsItem",
        resourceId: item.id,
        statusCode: 200,
        seo: { title: String(item.values.title ?? item.slug) },
      });
    }
  }

  // The 404 handler is a route so the renderer never needs a hardcoded fallback page.
  routes.push({
    path: "/404",
    kind: "system",
    resourceId: "not-found",
    statusCode: 404,
    seo: { title: "Page not found", robots: { index: false, follow: false } },
  });

  return routes;
}

/**
 * Redirects that survive into the snapshot.
 *
 * Chains are flattened first so a visitor makes one hop, and a redirect whose source is a real route
 * is dropped: keeping it would make an existing page unreachable.
 */
function compileRedirects(redirects: readonly Redirect[], routes: readonly RouteManifestEntry[]): PublishedRedirect[] {
  const livePaths = new Set(routes.map((route) => route.path));
  const pathByResource = new Map(routes.map((route) => [route.resourceId, route.path]));

  const resolveDestinationPath = (destination: Redirect["destination"]): string | null =>
    destination.type === "internalPath" ? destination.path : (pathByResource.get(destination.targetId) ?? null);

  return flattenChains(redirects, resolveDestinationPath)
    .filter((redirect) => !livePaths.has(redirect.sourcePath))
    .map((redirect) => ({ sourcePath: redirect.sourcePath, destinationPath: redirect.finalPath, statusCode: 301 }) as const)
    .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
}

/**
 * Media the published site will request.
 *
 * Drafts contribute nothing: an image used only by an unpublished post must not keep that media
 * alive, or retention can never reclaim anything.
 */
function collectMediaIds(input: CompileInput): string[] {
  const ids = new Set<string>();

  const addSections = (sections: readonly BuilderProject["sharedSections"][number][]) => {
    for (const section of sections) {
      for (const element of walkElements(section.elements)) {
        if (element.type === "image" && element.source.kind === "media") ids.add(element.source.mediaId);
      }
    }
  };

  for (const page of input.project.pages) addSections(page.sections);
  addSections(input.project.sharedSections);

  if (input.project.seo.defaultSocialMediaId !== undefined) ids.add(input.project.seo.defaultSocialMediaId);
  if (input.project.seo.organization?.logoMediaId !== undefined) ids.add(input.project.seo.organization.logoMediaId);

  if (input.blog.settings.enabled) {
    for (const post of publishedOnly(input.blog.posts)) {
      if (post.coverMediaId !== undefined) ids.add(post.coverMediaId);
    }
  }

  // Sorted so the same revision always yields the same array, and therefore the same hash.
  return [...ids].sort();
}

function collectSearchSources(input: CompileInput, routes: readonly RouteManifestEntry[]): SearchSource[] {
  const pathByResource = new Map(routes.map((route) => [route.resourceId, route.path]));
  const sources: SearchSource[] = [];

  for (const page of input.project.pages) {
    sources.push({
      kind: "page",
      id: page.id,
      title: page.seo.title || page.name,
      body: pageText(page),
      path: pathByResource.get(page.id) ?? pagePath(page),
      indexable: page.seo.robots.index && input.project.seo.defaultRobots.index,
      published: true,
    });
  }

  if (input.blog.settings.enabled) {
    for (const post of publishedOnly(input.blog.posts)) {
      sources.push({
        kind: "post",
        id: post.id,
        title: post.title,
        body: post.excerpt ?? "",
        path: pathByResource.get(post.id) ?? postPath(input.blog.settings.basePath, post.slug),
        indexable: true,
        published: true,
      });
    }
  }

  for (const item of input.cms.items) {
    const path = pathByResource.get(item.id);
    if (item.status !== "published" || path === undefined) continue;
    sources.push({
      kind: "cmsItem",
      id: item.id,
      title: String(item.values.title ?? item.slug),
      body: Object.values(item.values).filter((value) => typeof value === "string").join(" "),
      path,
      indexable: true,
      published: true,
    });
  }

  return sources;
}

function pageText(page: BuilderProject["pages"][number]): string {
  const parts: string[] = [];
  for (const section of page.sections) {
    for (const element of walkElements(section.elements)) {
      if (element.type === "text") parts.push(element.content);
      if (element.type === "button") parts.push(element.text);
    }
  }
  return parts.join(" ");
}

/**
 * The parts of the document a visitor can actually observe.
 *
 * Bookkeeping is dropped — revision, timestamps, ownership and the feature projection all move on
 * saves that change nothing on the page. Hashing them would make every republish look like new
 * content, which defeats the only question the hash exists to answer.
 */
function normalizeForHash(document: BuilderProject): unknown {
  return {
    schemaVersion: document.schemaVersion,
    name: document.name,
    slug: document.slug,
    breakpoints: document.breakpoints,
    pages: document.pages,
    sharedSections: document.sharedSections,
    seo: document.seo,
  };
}

function publishedOnly(posts: readonly PublishablePost[]): PublishablePost[] {
  return posts.filter((post) => post.status === "published");
}

function isIndexable(route: RouteManifestEntry): boolean {
  if (route.statusCode !== 200) return false;
  const robots = route.seo.robots;
  return typeof robots !== "object" || robots === null || (robots as { index?: boolean }).index !== false;
}
