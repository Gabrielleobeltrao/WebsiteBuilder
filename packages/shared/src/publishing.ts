import type { BlogSettings } from "./blog";
import type { PublishedForm } from "./forms";
import type { PublishableBlog } from "./publication";
import { z } from "zod";

import { DEVICE_MODES } from "./devices";
import type { BlockFinding } from "./block-readiness";
import type { ResponsiveFinding, WidthRange } from "./diagnostics";
import { isReservedSubdomain, normalizeHostname, projectSlugSchema } from "./slug";

/**
 * Publication and domain contracts.
 *
 * The central guarantee: a published version is immutable and live traffic is changed only by
 * moving one pointer. A failed build therefore cannot degrade a running site, and rollback is a
 * pointer move rather than a rebuild — which means it cannot fail halfway.
 */

export const routeKinds = ["page", "blogIndex", "blogPost", "cmsList", "cmsItem", "system"] as const;
export type RouteKind = (typeof routeKinds)[number];

export const routeManifestEntrySchema = z
  .object({
    path: z.string().startsWith("/"),
    kind: z.enum(routeKinds),
    resourceId: z.string().min(1),
    statusCode: z.union([z.literal(200), z.literal(404)]),
    /** Fully resolved metadata. The renderer serialises it; it never resolves anything itself. */
    seo: z.record(z.string(), z.unknown()),
  })
  .strict();

export type RouteManifestEntry = z.infer<typeof routeManifestEntrySchema>;

export const publishedRedirectSchema = z
  .object({
    sourcePath: z.string().startsWith("/"),
    destinationPath: z.string().startsWith("/"),
    statusCode: z.literal(301),
  })
  .strict();

export type PublishedRedirect = z.infer<typeof publishedRedirectSchema>;

/**
 * Whether a visitor has the work that is saved.
 *
 * `unknown` is a first-class answer, not a failure. A version published before source fingerprints
 * existed recorded nothing to compare against, and its revision only describes the builder document
 * — so a post, a layout or a blog setting could all have moved since with no way to prove it either
 * way. Saying "up to date" there would be the product asserting something it cannot know, which is
 * the class of claim this whole plan exists to remove.
 */
export const PUBLICATION_STATES = ["up-to-date", "pending", "unknown"] as const;
export type PublicationState = (typeof PUBLICATION_STATES)[number];

export type PublishedSiteVersion = {
  id: string;
  workspaceId: string;
  projectId: string;
  version: number;
  /** The exact project revision this was compiled from. */
  sourceRevision: number;
  schemaVersion: number;
  document: unknown;
  routes: RouteManifestEntry[];
  redirects: PublishedRedirect[];
  /**
   * The form definitions this version's pages reference, frozen at the revision that was live.
   *
   * Stored with the version rather than read live, because a version is immutable by contract: a
   * visitor filling in a form must not have the questions changed under them, and a submission
   * stored against a definition rewritten since must still be readable. Absent on versions
   * published before forms were carried, which is the same as none.
   */
  forms?: readonly PublishedForm[];
  /**
   * The blog as this version froze it: settings, published posts, and the two templates its routes
   * render through. Absent means this version publishes no blog routes.
   */
  blog?: PublishableBlog;
  referencedMediaIds: string[];
  contentHash: string;
  /**
   * The publishable sources this version was compiled from, as one comparable value.
   *
   * Absent on versions published before it existed, which reads as "cannot tell from the snapshot"
   * rather than as "nothing changed" — the caller falls back to the revision comparison it used to
   * make, instead of inventing an answer.
   */
  sourceFingerprint?: string;
  createdByUserId: string;
  createdAt: string;
};

export const DOMAIN_STATUSES = [
  "pending_dns",
  "verifying",
  "pending_ssl",
  "active",
  "failed",
  "disconnected",
] as const;
export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

export type SiteDomain = {
  id: string;
  workspaceId: string;
  projectId: string;
  hostname: string;
  kind: "platform" | "custom";
  status: DomainStatus;
  isPrimary: boolean;
  provider: "platform_wildcard" | "cloudflare_for_saas";
  providerHostnameId?: string;
  verification?: { method: "cname" | "txt" | "http"; name?: string; value?: string };
  sslStatus?: "pending" | "active" | "failed";
  lastCheckedAt?: string;
  failureCode?: string;
  createdAt: string;
  verifiedAt?: string;
};

/**
 * Builds a project's permanent platform hostname.
 *
 * Returns null for a slug that cannot be a DNS label or that claims a reserved infrastructure
 * name — a project shadowing `api` or `origin` would break the platform for everyone.
 */
export function platformHostname(
  projectSlug: string,
  rootDomain: string,
  extraReserved: readonly string[] = [],
): string | null {
  if (!projectSlugSchema.safeParse(projectSlug).success) return null;
  if (isReservedSubdomain(projectSlug, extraReserved)) return null;
  return normalizeHostname(`${projectSlug}.${rootDomain}`);
}

export type PreflightIssue = {
  code:
    | "no-pages"
    | "route-collision"
    | "missing-media"
    | "unsupported-schema"
    | "module-incomplete"
    | "document-too-large"
    | "revision-changed"
    | "responsive-layout"
    | "block-incomplete";
  severity: "blocking" | "warning";
  detail: string;
  path?: string;
  /**
   * Where the problem is, when it is somewhere in particular.
   *
   * A readiness report that says "an element overflows" and stops is a report the reader has to
   * re-derive by hand. These three fields are what let the UI offer to open the exact element, on
   * the exact device, in the builder.
   */
  pageId?: string;
  elementId?: string;
  /** Widths the problem occurs at. */
  ranges?: WidthRange[];
  /** For a block finding, the specific check that produced it, so the UI can open the right field. */
  blockCode?: string;
  /**
   * The form a finding is about, when the fix is in the form rather than on the page.
   *
   * "This form asks nothing" is not fixed by opening the block that shows it; it is fixed by
   * opening the form's questions. A finding that sends somebody to the wrong screen is a finding
   * they have to translate before they can act on it.
   */
  formId?: string;
};

/**
 * Whether a layout error reaches a width the author was given a way to fix.
 *
 * The sweep reports at widths nobody authors, and it should: a page correct at 390 and 1440 can
 * still break at 700, and that is worth knowing. But refusing to publish over it would be a gate
 * the product cannot help anyone through — there is no 320 device mode, no 700 device mode, and no
 * auto-fit for either. A 1440-wide design on a 1280 laptop scrolls horizontally, which is what a
 * fixed-width design does; it is not a defect.
 *
 * So blocking is limited to the narrow widths the builder actually exposes: phone and tablet. There
 * a person has a device button, an override and a "fit to this device" action, so "this is broken"
 * comes with somewhere to go. Everything else is reported and left to the person who designed it.
 */
function breaksANarrowDevice(finding: { ranges: readonly WidthRange[] }): boolean {
  return finding.ranges.some((range) =>
    BLOCKING_DEVICE_WIDTHS.some((width) => range.from <= width && width <= range.to),
  );
}

/** The authored widths where horizontal overflow makes content unreachable: phone and tablet. */
export const BLOCKING_DEVICE_WIDTHS = [DEVICE_MODES.mobile.referenceWidth, DEVICE_MODES.tablet.referenceWidth] as const;

export type PreflightReport = {
  issues: PreflightIssue[];
  blocked: boolean;
  routeCount: number;
  sourceRevision: number;
};

/**
 * Deterministic preflight.
 *
 * Everything here is checkable from one exact revision, so the same input always yields the same
 * report. Only issues that would produce a broken public site block; the rest are surfaced so the
 * decision is informed rather than prevented.
 */
export function preflight(input: {
  sourceRevision: number;
  routes: readonly RouteManifestEntry[];
  /** Layout findings from the responsive sweep, already attributed to their page. */
  responsive?: readonly (ResponsiveFinding & { pageId: string })[];
  /** Blocks that are not finished: no video id, no form, no alternative text. */
  blocks?: readonly BlockFinding[];
  referencedMediaIds: readonly string[];
  mediaExists: (mediaId: string) => boolean;
  schemaVersion: number;
  supportedSchemaVersion: number;
  moduleBlockers: number;
  documentBytes: number;
  maxDocumentBytes: number;
}): PreflightReport {
  const issues: PreflightIssue[] = [];

  if (input.routes.length === 0) {
    issues.push({ code: "no-pages", severity: "blocking", detail: "This site has no routes to publish." });
  }

  const seen = new Map<string, RouteManifestEntry>();
  for (const route of input.routes) {
    const existing = seen.get(route.path);
    if (existing !== undefined) {
      issues.push({
        code: "route-collision",
        severity: "blocking",
        path: route.path,
        detail: `Two resources claim ${route.path}: a ${existing.kind} and a ${route.kind}.`,
      });
      continue;
    }
    seen.set(route.path, route);
  }

  for (const mediaId of input.referencedMediaIds) {
    if (!input.mediaExists(mediaId)) {
      issues.push({
        code: "missing-media",
        severity: "blocking",
        detail: `An image referenced by this site no longer exists (${mediaId}).`,
      });
    }
  }

  if (input.schemaVersion !== input.supportedSchemaVersion) {
    issues.push({
      code: "unsupported-schema",
      severity: "blocking",
      detail: `This document uses schema version ${input.schemaVersion}; the renderer supports ${input.supportedSchemaVersion}.`,
    });
  }

  if (input.moduleBlockers > 0) {
    issues.push({
      code: "module-incomplete",
      severity: "blocking",
      detail: `${input.moduleBlockers} module setup issue(s) must be resolved before publishing.`,
    });
  }

  for (const finding of input.responsive ?? []) {
    issues.push({
      code: "responsive-layout",
      severity: finding.severity === "error" && breaksANarrowDevice(finding) ? "blocking" : "warning",
      detail: finding.detail,
      path: finding.path,
      pageId: finding.pageId,
      ...(finding.elementId === undefined ? {} : { elementId: finding.elementId }),
      ranges: finding.ranges,
    });
  }

  for (const finding of input.blocks ?? []) {
    // An unconfigured block reaches a visitor as a broken site rather than an unfinished one, so
    // the ones that cannot work at all block publication. The rest are reported.
    issues.push({
      code: "block-incomplete",
      blockCode: finding.code,
      severity: finding.severity === "error" ? "blocking" : "warning",
      detail: finding.detail,
      path: finding.path,
      pageId: finding.pageId,
      ...(finding.elementId === "" ? {} : { elementId: finding.elementId }),
      ...(finding.formId === undefined ? {} : { formId: finding.formId }),
    });
  }

  if (input.documentBytes > input.maxDocumentBytes) {
    issues.push({
      code: "document-too-large",
      severity: "blocking",
      detail: `This site is ${input.documentBytes} bytes; the limit is ${input.maxDocumentBytes}.`,
    });
  }

  return {
    issues,
    blocked: issues.some((issue) => issue.severity === "blocking"),
    routeCount: seen.size,
    sourceRevision: input.sourceRevision,
  };
}

/**
 * Content hash over the parts that determine what a visitor receives.
 *
 * Timestamps and version numbers are excluded on purpose: republishing an unchanged site must
 * produce the same hash, so "nothing actually changed" is detectable rather than guessed at.
 */
export function contentHash(input: {
  document: unknown;
  routes: readonly RouteManifestEntry[];
  redirects: readonly PublishedRedirect[];
  /**
   * The form definitions the pages reference.
   *
   * Part of what a visitor receives, and therefore part of the identity of a version. Left out, a
   * form edited and republished hashed identically, publishing concluded nothing had changed, and
   * the live site went on asking the old questions with no way to ever reach the new ones.
   */
  forms?: readonly PublishedForm[];
  /** The blog, for the same reason: an edited article is a change to what a visitor receives. */
  blog?: PublishableBlog;
}): string {
  const canonical = JSON.stringify({
    document: input.document,
    routes: [...input.routes].sort((a, b) => a.path.localeCompare(b.path)),
    redirects: [...input.redirects].sort((a, b) => a.sourcePath.localeCompare(b.sourcePath)),
    forms: [...(input.forms ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
    blog: input.blog === undefined ? null : { ...input.blog, posts: [...input.blog.posts].sort((a, b) => a.id.localeCompare(b.id)) },
  });

  return fnv1a(canonical);
}

/**
 * FNV-1a: short, dependency-free and stable across runtimes.
 *
 * This detects change. It is not a security primitive and nothing authenticates with it.
 */
function fnv1a(canonical: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Everything publishable about a site, reduced to one comparable value.
 *
 * "Are there unpublished changes" was answered by comparing the project's revision with the one the
 * live snapshot was compiled from. That is true only of the builder document. Posts, blog settings
 * and the two layouts live in their own collections and do not touch the project's revision — so a
 * customer could write a post, publish it, and be told by both the site card and the dashboard that
 * their site was up to date, which is the same class of lie this whole plan set out to remove.
 *
 * Deliberately computed from source *identity* rather than from source content: the compiler's
 * `contentHash` is the authority on whether output changed, but obtaining it means compiling the
 * whole site, and a list of two hundred cards cannot compile two hundred sites to draw a badge.
 * Everything here is available from a grouped query.
 *
 * The blog reduces to a count and a latest-change time because that pair moves for every single
 * mutation: an edit or a publish stamps `updatedAt`, a creation stamps it too and becomes the
 * newest, and a deletion — the one act that stamps nothing — lowers the count.
 */
export function publicationSourceFingerprint(input: {
  projectRevision: number;
  blog?: {
    /** Every setting a snapshot freezes, so changing any of them counts as unpublished work. */
    settings: BlogSettings;
    /** Posts a publication would include: published ones only. */
    publishablePostCount: number;
    /** The newest `updatedAt` among them, or null when there are none. */
    latestPostChangeAt: string | null;
    /** Each layout's published version number, or null when it has never been published. */
    indexTemplateVersion: number | null;
    articleTemplateVersion: number | null;
  };
}): string {
  return fnv1a(
    JSON.stringify({
      projectRevision: input.projectRevision,
      blog:
        input.blog === undefined
          ? null
          : {
              /*
               * The settings the compiler freezes, all of them, in a fixed order.
               *
               * Three of the seven used to be read — so changing how many posts a page shows, or the
               * name a post is bylined with, changed what visitors receive and was reported as
               * nothing to publish. Listing the keys rather than hashing the object also keeps a
               * stored `_id` or a workspace field out of the value.
               */
              settings: [
                input.blog.settings.enabled,
                input.blog.settings.basePath,
                input.blog.settings.format ?? null,
                input.blog.settings.postsPerPage,
                input.blog.settings.defaultAuthorName ?? null,
                input.blog.settings.indexTemplateId ?? null,
                input.blog.settings.articleTemplateId ?? null,
              ],
              posts: [input.blog.publishablePostCount, input.blog.latestPostChangeAt],
              templates: [input.blog.indexTemplateVersion, input.blog.articleTemplateVersion],
            },
    }),
  );
}

/** A domain serves traffic only when every stage is genuinely complete. */
export function isDomainLive(domain: Pick<SiteDomain, "status" | "sslStatus">): boolean {
  return domain.status === "active" && domain.sslStatus === "active";
}

/**
 * Resolves an incoming hostname to a project.
 *
 * Only an active domain resolves. A pending, failed or disconnected host returns null, and the
 * caller answers with a neutral response rather than falling back to any other tenant.
 */
export function resolveHost(
  rawHostname: string,
  domains: readonly SiteDomain[],
): { projectId: string; domain: SiteDomain } | null {
  const hostname = normalizeHostname(rawHostname);
  if (hostname === null) return null;

  const domain = domains.find((candidate) => candidate.hostname === hostname && isDomainLive(candidate));
  return domain === undefined ? null : { projectId: domain.projectId, domain };
}

/** Secondary hostnames redirect to the primary so one canonical URL exists per site. */
export function canonicalRedirectFor(
  domain: SiteDomain,
  domains: readonly SiteDomain[],
): { toHostname: string } | null {
  if (domain.isPrimary) return null;
  const primary = domains.find(
    (candidate) => candidate.projectId === domain.projectId && candidate.isPrimary && isDomainLive(candidate),
  );
  return primary === undefined ? null : { toHostname: primary.hostname };
}
