import { Router } from "express";
import type { Db } from "mongodb";
import { z } from "zod";

import { ApiProblem } from "../../middleware/errors";
import { resolveSession } from "../../middleware/session";
import type { Auth } from "../auth/auth";
import type { WorkspaceResolver } from "../projects/routes";
import { loadWorkspaceDashboard } from "./dashboard";
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

      // Every account needs somewhere to go. Signing up creates the user; nothing created their
      // workspace, so a new account had no workspace at all and the app had nowhere to send it.
      // Doing it here is idempotent by construction and runs on the first authenticated call the
      // client makes, so it cannot be skipped by entering through a different screen.
      if ((await workspaces.listForUser(user.id)).length === 0) {
        await workspaces.ensurePersonalWorkspace({ userId: user.id, name: user.name || user.email });
      }

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

/**
 * Windows the dashboard offers.
 *
 * An allowlist rather than an arbitrary number: a range is a scan over an indexed collection, and
 * `?days=100000` should not be a way to ask the database to read a customer's entire history on
 * every page load.
 */
const DASHBOARD_WINDOWS = [7, 30, 90] as const;

const dashboardQuerySchema = z
  .object({
    days: z.coerce.number().int().refine((value): value is (typeof DASHBOARD_WINDOWS)[number] =>
      DASHBOARD_WINDOWS.includes(value as (typeof DASHBOARD_WINDOWS)[number]),
    ),
    projectId: z.string().min(1).max(64),
  })
  .partial()
  .strict();

/**
 * The workspace overview: what exists, and what it received.
 *
 * Read through the same workspace resolver as everything else, so the numbers are scoped by a
 * server-verified membership before any collection is touched. `projectId` narrows traffic only —
 * it is matched inside the workspace filter, so asking for another tenant's site returns that
 * site's zero, never its data.
 */
export function createWorkspaceDashboardRouter(options: { db: Db; resolveWorkspace: WorkspaceResolver }): Router {
  const { db, resolveWorkspace } = options;
  const router = Router({ mergeParams: true });

  router.get("/", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      const query = dashboardQuerySchema.safeParse(req.query);
      if (!query.success) throw new ApiProblem("VALIDATION_ERROR", "The dashboard filter is not valid");

      res.json({ data: await loadWorkspaceDashboard(db, context, query.data) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
