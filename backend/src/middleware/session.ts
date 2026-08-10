import type { Request } from "express";

import { ApiProblem } from "./errors";
import type { Auth } from "../modules/auth/auth";
import type { WorkspaceContext } from "../modules/projects/repository";
import type { WorkspaceResolver } from "../modules/projects/routes";
import { can, type Permission } from "../modules/workspaces/permissions";
import type { WorkspaceRepository } from "../modules/workspaces/repository";

export type AuthenticatedUser = { id: string; email: string };

/** Reads the verified session, or null when the request carries none. */
export async function resolveSession(auth: Auth, req: Request): Promise<AuthenticatedUser | null> {
  const session = await auth.api.getSession({ headers: toHeaders(req) });
  if (!session?.user?.id) return null;
  return { id: session.user.id, email: String(session.user.email ?? "") };
}

function toHeaders(req: Request): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(", "));
  }
  return headers;
}

/**
 * Resolves the verified tenant context for a business request.
 *
 * Order matters and is the whole point: authenticate, then read membership for the workspace named
 * in the URL, then check the permission the route needs. The workspace ID in the path is a request,
 * not a claim — nothing is trusted until the membership record is found in the database.
 */
export function createWorkspaceResolver(options: {
  auth: Auth;
  workspaces: WorkspaceRepository;
  permission: Permission;
}): WorkspaceResolver {
  const { auth, workspaces, permission } = options;

  return async (req: Request): Promise<WorkspaceContext> => {
    const user = await resolveSession(auth, req);
    if (user === null) throw new ApiProblem("UNAUTHENTICATED", "Authentication is required");

    const workspaceId = req.params.workspaceId;
    if (typeof workspaceId !== "string" || workspaceId.length === 0) {
      throw new ApiProblem("NOT_FOUND", "Workspace not found");
    }

    const membership = await workspaces.findMembership(workspaceId, user.id);
    // A non-member and a non-existent workspace get the same answer, so membership cannot be
    // probed by comparing responses.
    if (membership === null) throw new ApiProblem("FORBIDDEN", "You do not have access to this workspace");

    if (!can(membership.role, permission)) {
      throw new ApiProblem("FORBIDDEN", "Your role does not allow this action");
    }

    return { workspaceId, userId: user.id };
  };
}
