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
 *
 * Caching is split by how each piece behaves. Host mappings and published snapshots are effectively
 * immutable — a snapshot never changes once written — so both are cached with a bounded TTL. The
 * project's active-version pointer is read on every request, because it is the one thing a publish
 * or a rollback moves, and the API that moves it runs in a different process from this one. There
 * is no channel to invalidate a cache across that boundary, so the pointer is simply never stale.
 * The cost is one indexed lookup by `_id`; the benefit is that a rollback takes effect at once
 * rather than up to a TTL later.
 */
export type ResolvedSite = { domain: SiteDomain; version: PublishedSiteVersion; document: BuilderProject };

export type RouteOutcome =
  | { kind: "route"; route: RouteManifestEntry }
  | { kind: "redirect"; location: string; statusCode: 301 }
  | { kind: "not-found"; route: RouteManifestEntry | null };

export class SiteResolver {
  private readonly hosts: TtlCache<{ projectId: string; domain: SiteDomain } | null>;
  private readonly versions: TtlCache<PublishedSiteVersion>;

  constructor(
    private readonly repository: PublishingRepository,
    ttlSeconds: number,
  ) {
    const ttlMs = Math.max(1, ttlSeconds) * 1000;
    this.hosts = new TtlCache(ttlMs);
    // Keyed by version id, which identifies immutable content. A stale entry is impossible.
    this.versions = new TtlCache(ttlMs, 100);
  }

  async resolve(rawHostname: string): Promise<ResolvedSite | null> {
    const key = rawHostname.toLowerCase();

    let match = this.hosts.get(key);
    if (match === undefined) {
      match = await this.repository.resolvePublicHost(rawHostname);
      // Misses are cached too. An unknown host is what a scanner sends, and it must not reach the
      // database on every request.
      this.hosts.set(key, match);
    }
    if (match === null) return null;

    const pointer = await this.repository.findActiveVersionId(match.projectId);
    // A domain pointing at a project that has never published is not an error and not another
    // tenant's site: it is simply not live.
    if (pointer === null) return null;

    let version = this.versions.get(pointer);
    if (version === undefined) {
      const loaded = await this.repository.findActive(match.projectId, pointer);
      if (loaded === null) return null;
      this.versions.set(pointer, loaded);
      version = loaded;
    }

    return { domain: match.domain, version, document: version.document as BuilderProject };
  }

  /** Drops one hostname's mapping, for a domain that was just connected or disconnected. */
  invalidateHost(hostname: string): void {
    this.hosts.invalidate(hostname.toLowerCase());
  }

  invalidateAll(): void {
    this.hosts.clear();
    this.versions.clear();
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
  return `/${pathname.split("/").filter((segment) => segment.length > 0).join("/")}`;
}
