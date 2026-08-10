import type { Request } from "express";

import { ApiProblem } from "./errors";
import type { WorkspaceContext } from "../modules/projects/repository";
import type { WorkspaceResolver } from "../modules/projects/routes";

/**
 * Development and test stand-in for the Better Auth session plus organization membership check
 * that Phase 7 installs.
 *
 * It resolves to one explicitly seeded workspace and then verifies that the workspace ID in the
 * URL matches it. What it deliberately does not do is trust a workspace ID supplied by the client,
 * or fall back to "no workspace" — an unscoped context is how every business query silently starts
 * returning another tenant's data.
 */
export function createSeededWorkspaceResolver(seeded: WorkspaceContext): WorkspaceResolver {
  return async (req: Request): Promise<WorkspaceContext> => {
    const requested = req.params.workspaceId;
    if (typeof requested !== "string" || requested.length === 0) {
      throw new ApiProblem("NOT_FOUND", "Workspace not found");
    }
    if (requested !== seeded.workspaceId) {
      throw new ApiProblem("FORBIDDEN", "You do not have access to this workspace");
    }
    return seeded;
  };
}
