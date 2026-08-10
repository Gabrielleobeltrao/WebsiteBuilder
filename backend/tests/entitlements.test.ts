import { describe, expect, it } from "vitest";

import {
  checkMemberLimit,
  checkSiteLimit,
  checkStorageLimit,
  DEVELOPMENT_ENTITLEMENT,
  resolveEntitlement,
  resolveOnboarding,
} from "../src/modules/workspaces/entitlements";

describe("entitlements", () => {
  it("resolves every workspace kind to the same development plan for now", () => {
    for (const kind of ["personal", "agency", "business"] as const) {
      expect(resolveEntitlement(kind)).toEqual(DEVELOPMENT_ENTITLEMENT);
    }
  });

  it("sets limits high enough not to block real work before payments exist", () => {
    expect(DEVELOPMENT_ENTITLEMENT.maxSites).toBeGreaterThanOrEqual(50);
    expect(DEVELOPMENT_ENTITLEMENT.customDomains).toBe(true);
  });

  it("allows up to the limit and refuses at it, reporting both numbers", () => {
    expect(checkSiteLimit(DEVELOPMENT_ENTITLEMENT, 99)).toEqual({ allowed: true });

    const refused = checkSiteLimit(DEVELOPMENT_ENTITLEMENT, 100);
    expect(refused).toEqual({ allowed: false, limit: 100, current: 100 });
  });

  it("checks storage against the incoming size, not only the current total", () => {
    const almostFull = DEVELOPMENT_ENTITLEMENT.maxMediaBytes - 1000;
    expect(checkStorageLimit(DEVELOPMENT_ENTITLEMENT, almostFull, 500)).toEqual({ allowed: true });
    expect(checkStorageLimit(DEVELOPMENT_ENTITLEMENT, almostFull, 5000).allowed).toBe(false);
  });

  it("checks the member limit", () => {
    expect(checkMemberLimit(DEVELOPMENT_ENTITLEMENT, 1)).toEqual({ allowed: true });
    expect(checkMemberLimit(DEVELOPMENT_ENTITLEMENT, 25).allowed).toBe(false);
  });
});

describe("onboarding", () => {
  it("hides Clients in a personal workspace that has none", () => {
    const state = resolveOnboarding({ workspaceKind: "personal", siteCount: 0, clientCount: 0, memberCount: 1 });
    expect(state.showClients).toBe(false);
    expect(state.nextStep).toBe("create-site");
  });

  it("shows Clients once a personal workspace creates one", () => {
    const state = resolveOnboarding({ workspaceKind: "personal", siteCount: 1, clientCount: 1, memberCount: 1 });
    expect(state.showClients).toBe(true);
  });

  it("shows Clients from the start in an agency workspace", () => {
    const state = resolveOnboarding({ workspaceKind: "agency", siteCount: 0, clientCount: 0, memberCount: 1 });
    expect(state.showClients).toBe(true);
    expect(state.nextStep).toBe("create-client");
  });

  it("sends a solo user straight to creating a site, with no client required", () => {
    const state = resolveOnboarding({ workspaceKind: "personal", siteCount: 0, clientCount: 0, memberCount: 1 });
    expect(state.showFirstSiteWizard).toBe(true);
    expect(state.nextStep).toBe("create-site");
  });

  it("suggests inviting the team once an agency has a site but no colleagues", () => {
    const state = resolveOnboarding({ workspaceKind: "agency", siteCount: 1, clientCount: 1, memberCount: 1 });
    expect(state.nextStep).toBe("invite-team");
  });

  it("stops suggesting setup once a workspace is established", () => {
    const state = resolveOnboarding({ workspaceKind: "agency", siteCount: 3, clientCount: 2, memberCount: 4 });
    expect(state.showFirstSiteWizard).toBe(false);
    expect(state.nextStep).toBe("open-site");
  });

  it("does not hardcode agency assumptions into a personal workspace's next step", () => {
    // A personal workspace with a site never gets pushed towards clients or invitations.
    const state = resolveOnboarding({ workspaceKind: "personal", siteCount: 1, clientCount: 0, memberCount: 1 });
    expect(state.nextStep).toBe("open-site");
  });
});
