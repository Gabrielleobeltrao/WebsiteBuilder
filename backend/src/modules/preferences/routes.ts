import { userPreferencesSchema } from "@websitebuilder/shared";
import { Router } from "express";

import { ApiProblem, zodProblem } from "../../middleware/errors";
import { resolveSession } from "../../middleware/session";
import type { Auth } from "../auth/auth";
import type { PreferencesRepository } from "./repository";

export function createPreferencesRouter(options: { auth: Auth; preferences: PreferencesRepository }): Router {
  const { auth, preferences } = options;
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const user = await resolveSession(auth, req);
      if (user === null) throw new ApiProblem("UNAUTHENTICATED", "Authentication is required");
      res.json({ data: { locale: await preferences.resolve(user.id) } });
    } catch (error) {
      next(error);
    }
  });

  router.put("/", async (req, res, next) => {
    try {
      const user = await resolveSession(auth, req);
      if (user === null) throw new ApiProblem("UNAUTHENTICATED", "Authentication is required");

      const parsed = userPreferencesSchema.safeParse(req.body);
      if (!parsed.success) throw zodProblem(parsed.error);

      // The record is keyed by the session's user ID. A userId in the body is ignored entirely,
      // so one account can never write another account's preference.
      res.json({ data: await preferences.save(user.id, parsed.data.locale) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
