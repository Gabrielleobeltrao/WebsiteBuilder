import { postPath, type BlogFieldDefinition, type BlogSettings, type RichTextDocument } from "./blog";
import type { PublishedForm } from "./forms";
import { normalizeCollectionSlug, type CmsCollectionInput, type CmsItemStatus } from "./cms";
import { auditPageBlocks, type BlockFinding } from "./block-readiness";
import { diagnoseResponsive, type ResponsiveFinding } from "./diagnostics";
import { walkElements } from "./elements";
import { pagePath, type BuilderPage, type BuilderProject } from "./project";
import { walkDocumentElements } from "./document-traversal";
import {
  contentHash,
  preflight,
  type PreflightReport,
  type PublishedRedirect,
  type RouteManifestEntry,
} from "./publishing";
import { flattenChains, type Redirect } from "./redirects";
import { buildSearchIndex, type SearchDocument, type SearchSource } from "./search";
import { renderablePage, resolvePageSections } from "./shared-sections";
import { resolvePageMetadata } from "./seo";
import { SYSTEM_PAGE_CONTRACTS, SYSTEM_PAGE_KINDS } from "./system-pages";

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
  /**
   * The article itself.
   *
   * Carried into the snapshot for the same reason a form definition is: the published route for
   * this post has to render something, and reading it live would mean a version was not immutable.
   * Absent reads as an empty article rather than as a missing one.
   */
  content?: RichTextDocument;
  authorName?: string;
  publishedAt?: string;
  updatedAt: string;
  seo?: { title?: string; description?: string };
  /**
   * The template's own fields, keyed by definition id.
   *
   * Carried for the same reason the body is: a template block bound to one of them has to render
   * something on the published page, and reading it live would mean a version was not immutable.
   * Without it a designer could bind a slot, an author could fill it in, and the live article drew
   * nothing — the value existed on both sides of a snapshot that did not carry it.
   */
  customFieldValues?: Record<string, unknown>;
};

/**
 * Everything a published site needs to serve its blog.
 *
 * The two templates are ordinary builder pages and are frozen here with the posts, so editing a
 * template changes the live site at the next publish and not before — the same rule every other
 * published thing follows.
 */
export type PublishableBlog = {
  settings: BlogSettings;
  posts: readonly PublishablePost[];
  indexTemplate?: BuilderPage;
  articleTemplate?: BuilderPage;
  /** What a post's custom values mean, frozen with them so a renamed field still resolves. */
  fieldDefinitions?: readonly BlogFieldDefinition[];
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
  blog: {
    settings: BlogSettings;
    posts: readonly PublishablePost[];
    /** The pages the blog's own routes render through. Without them those routes serve nothing. */
    indexTemplate?: BuilderPage;
    articleTemplate?: BuilderPage;
    fieldDefinitions?: readonly BlogFieldDefinition[];
  };
  cms: { collections: readonly PublishableCollection[]; items: readonly PublishableCmsItem[] };
  redirects: readonly Redirect[];
  /**
   * Form definitions this project owns, so a published page can render the fields it references.
   *
   * Copied into the snapshot rather than read live: a published version is immutable, and a form
   * edited after publication must not silently change the page a visitor is filling in. The next
   * publish carries the new definition.
   */
  forms?: readonly PublishableForm[];
  /** Media ids the workspace actually owns. Ownership is decided by the caller, never inferred. */
  mediaExists: (mediaId: string) => boolean;
  supportedSchemaVersion: number;
  /** Blocking issues from the Site status center, already reconciled from source records. */
  moduleBlockers: number;
  maxDocumentBytes: number;
};

/**
 * The parts of a form definition a published page needs to render and validate it.
 *
 * The same shape the renderer consumes, typed rather than `unknown[]`: a published page validates a
 * submission against exactly this, so a field list nobody can read is a field list nobody can check.
 */
export type PublishableForm = PublishedForm;

export type CompiledSnapshot = {
  sourceRevision: number;
  schemaVersion: number;
  document: BuilderProject;
  routes: RouteManifestEntry[];
  redirects: PublishedRedirect[];
  forms: readonly PublishableForm[];
  /** Present only for a site whose blog is on. Absent means the site publishes no blog routes. */
  blog?: PublishableBlog;
  referencedMediaIds: string[];
  searchIndex: SearchDocument[];
  sitemapPaths: string[];
  contentHash: string;
};

export type CompileResult =
  | { ok: true; snapshot: CompiledSnapshot; report: PreflightReport }
  | { ok: false; snapshot: null; report: PreflightReport };

/**
 * The responsive sweep over every page, as the publisher sees it.
 *
 * Shared references are resolved first, because a header is where an overflow usually is and a page
 * that never resolves its header would report the site as clean while a phone shows it broken.
 */
/**
 * Blocks pointing at a form that cannot take a submission.
 *
 * Checked here rather than in block readiness because only the publisher knows which definitions
 * exist: a page's own document holds an id and nothing else. A form that was deleted, archived, or
 * never finished would otherwise publish as a set of inputs that accept an answer and lose it.
 *
 * Shared sections are resolved first. A form in a shared header is on every page of the site, and
 * walking the stored sections would report it as absent while every visitor saw it.
 */
function auditFormReferences(input: CompileInput): BlockFinding[] {
  const byId = new Map((input.forms ?? []).map((form) => [form.id, form]));
  const findings: BlockFinding[] = [];
  const reported = new Set<string>();

  const pageIds = new Set(input.project.pages.map((page) => page.id));

  for (const page of input.project.pages) {
    for (const section of resolvePageSections(input.project, page)) {
      if (section.hidden) continue;

      for (const element of walkElements(section.elements)) {
        if (element.type !== "form" || element.hidden || element.formId === "") continue;
        // One block, one finding, whatever number of pages a shared section puts it on.
        if (reported.has(element.id)) continue;
        reported.add(element.id);

        const form = byId.get(element.formId);
        const at = {
          path: pagePath(page),
          elementId: element.id,
          pageId: page.id,
          formId: element.formId,
          severity: "error" as const,
        };

        if (form === undefined) {
          findings.push({ ...at, code: "form-missing", detail: "This block points at a form that no longer exists." });
          continue;
        }

        if (form.status === "archived") {
          findings.push({
            ...at,
            code: "form-archived",
            detail: "The form this block shows is archived, so it would not accept an answer.",
          });
          continue;
        }

        if (form.fields.filter((field) => field.type !== "hidden").length === 0) {
          findings.push({
            ...at,
            code: "form-without-fields",
            detail: "The form this block shows asks nothing, so nobody could complete it.",
          });
          continue;
        }

        // A choice with no options is a control a visitor cannot answer, and a required one is a
        // form nobody can submit at all.
        const emptyChoice = form.fields.find(
          (field) => (field.type === "select" || field.type === "radio") && (field.options ?? []).length === 0,
        );
        if (emptyChoice !== undefined) {
          findings.push({
            ...at,
            code: "form-choice-without-options",
            detail: `"${emptyChoice.label}" offers no choices, so a visitor has nothing to pick.`,
          });
          continue;
        }

        // Sending somebody to a page this site does not have is a dead end at the exact moment they
        // have finished doing what was asked of them.
        if (form.successBehavior.type === "internalRedirect" && !pageIds.has(form.successBehavior.pageId)) {
          findings.push({
            ...at,
            code: "form-redirect-missing",
            detail: "This form sends people to a page that no longer exists after they submit it.",
          });
          continue;
        }

        if (form.status !== "ready") {
          findings.push({
            ...at,
            code: "form-incomplete",
            detail: "The form this block shows is not finished, so a visitor's answer would go nowhere.",
          });
        }
      }
    }
  }

  return findings;
}

/** Form ids referenced by any block on any page. */
/**
 * Every form the site actually shows.
 *
 * This walked pages only. A form placed in a shared header or footer — which is where a contact form
 * most often goes, because it belongs on every page — passed the audit and its definition was left
 * out of the snapshot, so the published page rendered a form that "no longer exists".
 *
 * A set, so a header shown on ten pages contributes one id rather than ten.
 */
function referencedFormIds(project: CompileInput["project"]): Set<string> {
  const ids = new Set<string>();
  for (const { element } of walkDocumentElements(project)) {
    if (element.type === "form" && element.formId !== "") ids.add(element.formId);
  }
  return ids;
}

function sweepPages(project: CompileInput["project"]): Array<ResponsiveFinding & { pageId: string }> {
  return project.pages.flatMap((page) =>
    diagnoseResponsive({
      page: renderablePage(project, page),
      path: page.isHome ? "/" : `/${page.slug}`,
      breakpoints: project.breakpoints,
    }).map((finding) => ({ ...finding, pageId: page.id })),
  );
}

/**
 * A post as published output should carry it: absent fields absent, not null and not blank.
 *
 * Mongo stores an unset optional as `null`, and `PublishablePost` declares these as
 * `string | undefined` — so `coverMediaId !== undefined` was true for a post with no cover, and
 * every published card and article rendered `<img src=".../null/content">`, with a `preload` link
 * in the head fetching that 404 eagerly. The byline did the same, printing a bare " · " separator
 * with nobody's name in front of it.
 *
 * Normalised at the one place a post crosses into published output, rather than guarded again at
 * each of the places that read it.
 */
export function normalizePublishablePost(post: PublishablePost): PublishablePost {
  const text = (value: unknown): string | undefined => {
    const trimmed = typeof value === "string" ? value.trim() : "";
    return trimmed === "" ? undefined : trimmed;
  };

  const next: PublishablePost = { ...post };
  // An empty map is left out rather than stored as {}: Mongo reads an absent field back as
  // undefined, and a snapshot that disagreed with its own read-back is the hash mismatch that
  // refused every publication once already.
  if (post.customFieldValues !== undefined && post.customFieldValues !== null && Object.keys(post.customFieldValues).length > 0) {
    next.customFieldValues = post.customFieldValues;
  } else {
    delete next.customFieldValues;
  }

  for (const key of ["coverMediaId", "authorName", "excerpt", "publishedAt"] as const) {
    const value = text(next[key]);
    if (value === undefined) delete next[key];
    else next[key] = value;
  }

  /*
   * The same for the SEO pair, and this one was breaking publication outright.
   *
   * A post with no SEO title produced `seo: { title: undefined, description: undefined }`. The
   * integrity check hashes what is written and hashes it again after reading it back — and Mongo
   * stores an absent value as `null`, so the two never matched. Every site publish with such a post
   * failed with `hash-mismatch`, which is a customer unable to publish their site at all because a
   * blog post has no SEO title.
   */
  const seo: PublishablePost["seo"] = {};
  if (text(post.seo?.title) !== undefined) seo.title = text(post.seo?.title);
  if (text(post.seo?.description) !== undefined) seo.description = text(post.seo?.description);
  next.seo = seo;

  return next;
}

export function compileSite(input: CompileInput): CompileResult {
  const routes = buildRouteManifest(input);
  const referencedMediaIds = collectMediaIds(input);
  const redirects = compileRedirects(input.redirects, routes);

  const document = input.project;
  const documentBytes = JSON.stringify(document).length;

  const report = preflight({
    sourceRevision: input.project.revision,
    routes,
    responsive: sweepPages(input.project),
    blocks: [
      ...input.project.pages.flatMap((page) => auditPageBlocks({ page, path: pagePath(page), document: input.project })),
      ...auditFormReferences(input),
    ],
    referencedMediaIds,
    mediaExists: input.mediaExists,
    schemaVersion: input.project.schemaVersion,
    supportedSchemaVersion: input.supportedSchemaVersion,
    moduleBlockers: input.moduleBlockers,
    documentBytes,
    maxDocumentBytes: input.maxDocumentBytes,
  });

  if (report.blocked) return { ok: false, snapshot: null, report };

  // Only the forms this site's pages actually reference: a snapshot carrying every definition in
  // the project would publish drafts nobody placed.
  const forms = (input.forms ?? []).filter((form) => referencedFormIds(input.project).has(form.id));

  // Only what the published routes need: the settings that shape them, the posts those routes point
  // at, and the two pages they render through.
  const blog: PublishableBlog | undefined = input.blog.settings.enabled
    ? {
        settings: input.blog.settings,
        posts: input.blog.posts.filter((post) => post.status === "published"),
        ...(input.blog.indexTemplate === undefined ? {} : { indexTemplate: input.blog.indexTemplate }),
        ...(input.blog.articleTemplate === undefined ? {} : { articleTemplate: input.blog.articleTemplate }),
        // Frozen with the posts: a definition renamed after this publication must not change what
        // an already-published article resolves.
        ...(input.blog.fieldDefinitions === undefined || input.blog.fieldDefinitions.length === 0
          ? {}
          : { fieldDefinitions: input.blog.fieldDefinitions }),
      }
    : undefined;

  const snapshot: CompiledSnapshot = {
    sourceRevision: input.project.revision,
    schemaVersion: input.project.schemaVersion,
    document,
    routes,
    redirects,
    forms,
    ...(blog === undefined ? {} : { blog }),
    referencedMediaIds,
    searchIndex: buildSearchIndex(collectSearchSources(input, routes)),
    // Only indexable routes belong in a sitemap; a 404 route is not a destination.
    sitemapPaths: routes.filter(isIndexable).map((route) => route.path),
    /*
     * What a visitor would receive, hashed.
     *
     * The forms belong in it. Without them, editing a form's questions and republishing produced an
     * identical hash, publishing decided nothing had changed, and the live site kept serving the old
     * questions — the edit could never reach production at all. A definition is part of the page in
     * every sense that matters to whoever fills it in.
     */
    contentHash: contentHash({ document: normalizeForHash(document), routes, redirects, forms, ...(blog === undefined ? {} : { blog }) }),
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

  // System pages are routes so the renderer never needs a hardcoded fallback. Each carries the
  // status its contract requires, whatever the designer put on it.
  for (const kind of SYSTEM_PAGE_KINDS) {
    const contract = SYSTEM_PAGE_CONTRACTS[kind];
    // A page with no fixed path is rendered in place of other content and claims no route.
    if (contract.path === null) continue;

    routes.push({
      path: contract.path,
      kind: "system",
      resourceId: kind,
      // The manifest only distinguishes 200 from 404; a 503 is served by the renderer from the
      // same entry when the site is in maintenance.
      statusCode: contract.statusCode === 404 ? 404 : 200,
      seo: { title: kind, robots: { index: false, follow: false } },
    });
  }

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
    // Which custom values are media is decided by the template's definitions; a bare string tells
    // nobody. An image field naming an asset the workspace does not own must block publication for
    // the same reason a cover does.
    const imageFields = (input.blog.fieldDefinitions ?? []).filter((definition) => definition.type === "image");

    for (const post of publishedOnly(input.blog.posts)) {
      if (post.coverMediaId !== undefined) ids.add(post.coverMediaId);

      for (const definition of imageFields) {
        const value = post.customFieldValues?.[definition.id];
        if (typeof value === "string" && value !== "") ids.add(value);
      }
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
