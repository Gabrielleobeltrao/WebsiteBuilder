import type { WorkspaceKind } from "./repository";

/**
 * Plan entitlements.
 *
 * Billing is explicitly out of scope, so this is a boundary rather than an implementation: one
 * function answers "may this workspace do X", and today every workspace resolves to the same
 * development plan. Adding paid tiers later means changing what `resolveEntitlement` returns, not
 * hunting for limit checks scattered through feature code.
 *
 * The limits are generous on purpose. A limit that bites before payments exist would block real
 * work to enforce a policy nobody has agreed to yet.
 */
export type Entitlement = {
  plan: "development";
  maxSites: number;
  maxTeamMembers: number;
  maxMediaBytes: number;
  customDomains: boolean;
};

export const DEVELOPMENT_ENTITLEMENT: Entitlement = {
  plan: "development",
  maxSites: 100,
  maxTeamMembers: 25,
  maxMediaBytes: 5 * 1024 * 1024 * 1024,
  customDomains: true,
};

export function resolveEntitlement(_workspaceKind: WorkspaceKind): Entitlement {
  return DEVELOPMENT_ENTITLEMENT;
}

export type LimitCheck = { allowed: true } | { allowed: false; limit: number; current: number };

export function checkSiteLimit(entitlement: Entitlement, currentSites: number): LimitCheck {
  return currentSites < entitlement.maxSites
    ? { allowed: true }
    : { allowed: false, limit: entitlement.maxSites, current: currentSites };
}

export function checkMemberLimit(entitlement: Entitlement, currentMembers: number): LimitCheck {
  return currentMembers < entitlement.maxTeamMembers
    ? { allowed: true }
    : { allowed: false, limit: entitlement.maxTeamMembers, current: currentMembers };
}

export function checkStorageLimit(entitlement: Entitlement, currentBytes: number, incomingBytes: number): LimitCheck {
  return currentBytes + incomingBytes <= entitlement.maxMediaBytes
    ? { allowed: true }
    : { allowed: false, limit: entitlement.maxMediaBytes, current: currentBytes };
}

/**
 * What a workspace should show a user who has just arrived.
 *
 * A personal workspace hides Clients until there is a reason for it: an individual with one site
 * has no clients, and a navigation entry that only ever shows an empty list teaches people to
 * ignore the sidebar. An agency workspace shows it from the start.
 */
export type OnboardingState = {
  showClients: boolean;
  showFirstSiteWizard: boolean;
  nextStep: "create-site" | "create-client" | "open-site" | "invite-team";
};

export function resolveOnboarding(input: {
  workspaceKind: WorkspaceKind;
  siteCount: number;
  clientCount: number;
  memberCount: number;
}): OnboardingState {
  const isAgency = input.workspaceKind !== "personal";
  const showClients = isAgency || input.clientCount > 0;

  const nextStep: OnboardingState["nextStep"] =
    input.siteCount === 0
      ? isAgency && input.clientCount === 0
        ? "create-client"
        : "create-site"
      : isAgency && input.memberCount <= 1
        ? "invite-team"
        : "open-site";

  return { showClients, showFirstSiteWizard: input.siteCount === 0, nextStep };
}
