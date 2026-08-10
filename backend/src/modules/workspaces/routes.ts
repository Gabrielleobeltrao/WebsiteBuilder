import { Router } from "express";

import { ApiProblem } from "../../middleware/errors";
import { resolveSession } from "../../middleware/session";
import type { Auth } from "../auth/auth";
import { permissionsFor } from "./permissions";
import type { WorkspaceRepository } from "./repository";

/**
 * Workspace listing and the active membership's permissions.
 *
 * The response tells the client what it may render; it never tells the server what to allow. Every
 * mutation re-checks the same matrix server-side.
 */
export function createWorkspacesRouter(options: { auth: Auth; workspaces: WorkspaceRepository }): Router {
  const { auth, workspaces } = options;
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const user = await resolveSession(auth, req);
      if (user === null) throw new ApiProblem("UNAUTHENTICATED", "Authentication is required");

      const owned = await workspaces.listForUser(user.id);
      const withRoles = await Promise.all(
        owned.map(async (workspace) => {
          const membership = await workspaces.findMembership(workspace.id, user.id);
          return {
            ...workspace,
            role: membership?.role ?? "viewer",
            permissions: membership ? permissionsFor(membership.role) : [],
          };
        }),
      );

      res.json({ data: withRoles });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
