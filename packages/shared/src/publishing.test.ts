import { describe, expect, it } from "vitest";

import {
  canonicalRedirectFor,
  contentHash,
  isDomainLive,
  platformHostname,
  preflight,
  resolveHost,
  type RouteManifestEntry,
  type SiteDomain,
} from "./publishing";

const route = (path: string, overrides: Partial<RouteManifestEntry> = {}): RouteManifestEntry => ({
  path,
  kind: "page",
  resourceId: path,
  statusCode: 200,
  seo: {},
  ...overrides,
});

const domain = (overrides: Partial<SiteDomain> = {}): SiteDomain => ({
  id: "d1",
  workspaceId: "w1",
  projectId: "p1",
  hostname: "acme.osistema.com",
  kind: "platform",
  status: "active",
  isPrimary: true,
  provider: "platform_wildcard",
  sslStatus: "active",
  createdAt: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

const basePreflight = {
  sourceRevision: 4,
  routes: [route("/"), route("/about")],
  referencedMediaIds: [],
  mediaExists: () => true,
  schemaVersion: 1,
  supportedSchemaVersion: 1,
  moduleBlockers: 0,
  documentBytes: 1000,
  maxDocumentBytes: 5_000_000,
};

describe("platformHostname", () => {
  it("builds the project hostname with no extra label", () => {
    expect(platformHostname("acme", "osistema.com")).toBe("acme.osistema.com");
  });

  it("refuses a reserved infrastructure label", () => {
    for (const reserved of ["api", "app", "origin", "customers", "www"]) {
      expect(platformHostname(reserved, "osistema.com")).toBeNull();
    }
  });

  it("refuses a deployment-configured extra reserved label", () => {
    expect(platformHostname("beta", "osistema.com", ["beta"])).toBeNull();
    expect(platformHostname("beta", "osistema.com")).toBe("beta.osistema.com");
  });

  it("refuses a slug that is not a valid DNS label", () => {
    expect(platformHostname("Acme Studio", "osistema.com")).toBeNull();
    expect(platformHostname("ab", "osistema.com")).toBeNull();
  });
});

describe("preflight", () => {
  it("passes a healthy site", () => {
    const report = preflight(basePreflight);
    expect(report.blocked).toBe(false);
    expect(report.routeCount).toBe(2);
    expect(report.sourceRevision).toBe(4);
  });

  it("blocks a site with no routes", () => {
    expect(preflight({ ...basePreflight, routes: [] }).blocked).toBe(true);
  });

  it("blocks a route collision and names both claimants", () => {
    const report = preflight({
      ...basePreflight,
      routes: [route("/about"), route("/about", { kind: "blogPost", resourceId: "post-1" })],
    });

    const collision = report.issues.find((issue) => issue.code === "route-collision");
    expect(collision?.detail).toContain("page");
    expect(collision?.detail).toContain("blogPost");
    expect(report.blocked).toBe(true);
  });

  it("blocks on media that no longer exists", () => {
    const report = preflight({
      ...basePreflight,
      referencedMediaIds: ["m1"],
      mediaExists: () => false,
    });
    expect(report.issues.some((issue) => issue.code === "missing-media")).toBe(true);
  });

  it("blocks an unsupported schema version rather than rendering it", () => {
    const report = preflight({ ...basePreflight, schemaVersion: 99 });
    expect(report.blocked).toBe(true);
  });

  it("blocks when a module in use is incomplete", () => {
    expect(preflight({ ...basePreflight, moduleBlockers: 2 }).blocked).toBe(true);
  });

  it("blocks a document over the configured size limit", () => {
    expect(preflight({ ...basePreflight, documentBytes: 10_000_000 }).blocked).toBe(true);
  });

  it("is deterministic for the same input", () => {
    expect(preflight(basePreflight)).toEqual(preflight(basePreflight));
  });
});

describe("contentHash", () => {
  const payload = {
    document: { pages: [{ id: "p1" }] },
    routes: [route("/"), route("/about")],
    redirects: [],
  };

  it("is stable for identical content", () => {
    expect(contentHash(payload)).toBe(contentHash(payload));
  });

  it("does not depend on route order", () => {
    expect(contentHash(payload)).toBe(contentHash({ ...payload, routes: [route("/about"), route("/")] }));
  });

  it("changes when the document changes", () => {
    expect(contentHash(payload)).not.toBe(contentHash({ ...payload, document: { pages: [{ id: "p2" }] } }));
  });

  it("changes when a redirect is added", () => {
    expect(contentHash(payload)).not.toBe(
      contentHash({ ...payload, redirects: [{ sourcePath: "/old", destinationPath: "/about", statusCode: 301 }] }),
    );
  });
});

describe("host resolution", () => {
  it("resolves an active host with active SSL", () => {
    expect(resolveHost("acme.osistema.com", [domain()])?.projectId).toBe("p1");
  });

  it("normalises the incoming host before matching", () => {
    expect(resolveHost("ACME.osistema.com:443.", [domain()])?.projectId).toBe("p1");
  });

  it("refuses a host whose verification is still pending", () => {
    expect(resolveHost("acme.osistema.com", [domain({ status: "pending_dns" })])).toBeNull();
    expect(resolveHost("acme.osistema.com", [domain({ sslStatus: "pending" })])).toBeNull();
  });

  it("refuses a disconnected host rather than falling back to another site", () => {
    const domains = [domain({ status: "disconnected" }), domain({ id: "d2", projectId: "p2", hostname: "other.osistema.com" })];
    expect(resolveHost("acme.osistema.com", domains)).toBeNull();
  });

  it("returns nothing for an unknown or malformed host", () => {
    expect(resolveHost("nobody.example.com", [domain()])).toBeNull();
    expect(resolveHost("not a host", [domain()])).toBeNull();
  });

  it("treats a host as live only when both status and SSL are active", () => {
    expect(isDomainLive(domain())).toBe(true);
    expect(isDomainLive(domain({ status: "verifying" }))).toBe(false);
    expect(isDomainLive(domain({ sslStatus: "failed" }))).toBe(false);
  });
});

describe("canonical redirects", () => {
  it("redirects a secondary host to the primary", () => {
    const primary = domain({ id: "d1", hostname: "www.customer.com", isPrimary: true });
    const secondary = domain({ id: "d2", hostname: "customer.com", isPrimary: false });

    expect(canonicalRedirectFor(secondary, [primary, secondary])).toEqual({ toHostname: "www.customer.com" });
  });

  it("does not redirect the primary to itself", () => {
    const primary = domain();
    expect(canonicalRedirectFor(primary, [primary])).toBeNull();
  });

  it("does not redirect to a primary that is not live", () => {
    const primary = domain({ id: "d1", hostname: "www.customer.com", isPrimary: true, status: "pending_ssl" });
    const secondary = domain({ id: "d2", hostname: "customer.com", isPrimary: false });

    expect(canonicalRedirectFor(secondary, [primary, secondary])).toBeNull();
  });

  it("never redirects to another project's primary", () => {
    const otherPrimary = domain({ id: "d9", projectId: "p2", hostname: "other.com", isPrimary: true });
    const secondary = domain({ id: "d2", hostname: "customer.com", isPrimary: false });

    expect(canonicalRedirectFor(secondary, [otherPrimary, secondary])).toBeNull();
  });
});
