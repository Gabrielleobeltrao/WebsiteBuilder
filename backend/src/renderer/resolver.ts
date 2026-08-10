import {
  canonicalRedirectFor,
  type BuilderProject,
  type PublishedSiteVersion,
  type RouteManifestEntry,
  type SiteDomain,
} from "@websitebuilder/shared";

import type { PublishingRepository } from "../modules/publishing/repository";
import { TtlCache } from "./cache";

/**
 * Turns an incoming request into the exact snapshot and route that answer it.
 *
 * Identity comes from the hostname and nothing else. There is deliberately no way to name a project
 * through a query parameter or a header: on a process serving every tenant, one such override is a
 * complete cross-tenant read.
 */
export type ResolvedSite = { domain: SiteDomain; version: PublishedSiteVersion; document: BuilderProject };

export type RouteOutcome =
  | { kind: "route"; route: RouteManifestEntry }
  | { kind: "redirect"; location: string; statusCode: 301 }
  | { kind: "not-found"; route: RouteManifestEntry | null };

export class SiteResolver {
  private readonly hosts: TtlCache<ResolvedSite | null>;

  constructor(
    private readonly repository: PublishingRepository,
    ttlSeconds: number,
  ) {
    this.hosts = new TtlCache<ResolvedSite | null>(Math.max(1, ttlSeconds) * 1000);
  }

  /**
   * Resolves a hostname to its live site.
   *
   * A miss is cached too. Otherwise an unknown host — which is what a scanner sends — would reach
   * the database on every request.
   */
  async resolve(rawHostname: string): Promise<ResolvedSite | null> {
    const key = rawHostname.toLowerCase();
    const cached = this.hosts.get(key);
    if (cached !== undefined) return cached;

    const match = await this.repository.resolvePublicHost(rawHostname);
    if (match === null) {
      this.hosts.set(key, null);
      return null;
    }

    const version = await this.repository.findActiveForProject(match.projectId);
    // A domain pointing at a project that has never published is not an error and not another
    // tenant's site: it is simply not live.
    const resolved =
      version === null
        ? null
        : { domain: match.domain, version, document: version.document as BuilderProject };

    this.hosts.set(key, resolved);
    return resolved;
  }

  /** Drops one hostname's entry so a publication is visible without waiting for the TTL. */
  invalidateHost(hostname: string): void {
    this.hosts.invalidate(hostname.toLowerCase());
  }

  invalidateAll(): void {
    this.hosts.clear();
  }

  /** Canonical host for a site, so secondary domains do not compete for the same content. */
  async canonicalHostFor(site: ResolvedSite): Promise<string | null> {
    const domains = await this.repository.listDomains(
      { workspaceId: site.domain.workspaceId, userId: "" },
      site.domain.projectId,
    );
    return canonicalRedirectFor(site.domain, domains)?.toHostname ?? null;
  }
}

/**
 * Matches a request path against the published manifest.
 *
 * Redirects are consulted only after the manifest, so a live page can never be shadowed by a stale
 * rule, and an unmatched path falls through to the site's own 404 route rather than a generic one.
 */
export function resolveRoute(version: PublishedSiteVersion, rawPath: string): RouteOutcome {
  const path = normalizePath(rawPath);

  const route = version.routes.find((candidate) => candidate.path === path && candidate.statusCode === 200);
  if (route !== undefined) return { kind: "route", route };

  const redirect = version.redirects.find((candidate) => candidate.sourcePath === path);
  if (redirect !== undefined) return { kind: "redirect", location: redirect.destinationPath, statusCode: 301 };

  return { kind: "not-found", route: version.routes.find((candidate) => candidate.statusCode === 404) ?? null };
}

/** Trailing slashes and duplicated separators must not produce a second URL for one page. */
export function normalizePath(rawPath: string): string {
  const [pathname = "/"] = rawPath.split("?");
  const collapsed = `/${pathname.split("/").filter((segment) => segment.length > 0).join("/")}`;
  return collapsed;
}
