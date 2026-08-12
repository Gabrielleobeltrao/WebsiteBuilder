import { z } from "zod";

import { DEVICE_MODES } from "./devices";
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
  referencedMediaIds: string[];
  contentHash: string;
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
    | "responsive-layout";
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
}): string {
  const canonical = JSON.stringify({
    document: input.document,
    routes: [...input.routes].sort((a, b) => a.path.localeCompare(b.path)),
    redirects: [...input.redirects].sort((a, b) => a.sourcePath.localeCompare(b.sourcePath)),
  });

  // FNV-1a: short, dependency-free and stable across runtimes. This detects change, it is not a
  // security primitive and nothing authenticates with it.
  let hash = 2_166_136_261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
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
