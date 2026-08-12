import { formDefinitionInputSchema, formDefinitionUpdateSchema, resourceIdSchema } from "@websitebuilder/shared";
import { Router } from "express";

import { ApiProblem } from "../../middleware/errors";
import type { WorkspaceResolver } from "../projects/routes";
import { FormRevisionConflictError, type FormRepository } from "./repository";

/** A stale write is a 409 carrying the revision to reload, never a silent overwrite. */
function mapFormError(error: unknown): unknown {
  if (error instanceof FormRevisionConflictError) {
    return new ApiProblem("REVISION_CONFLICT", "This form was modified after it was loaded", [
      { path: "expectedRevision", message: `current revision is ${error.currentRevision}` },
    ]);
  }
  return error;
}

/**
 * Form definitions, mounted beneath `/workspaces/:workspaceId/projects/:projectId/forms`.
 *
 * A form is edited once and shown by however many pages reference it, so the definition lives here
 * rather than on the block: a copy per block would drift from the one that actually validates a
 * submission, and the two would disagree about what a required field is.
 *
 * Every route resolves the workspace first and passes that context to the repository, so a form id
 * from another tenant finds nothing rather than someone else's fields.
 */
function param(req: { params: unknown }, name: string): string {
  return (req.params as Record<string, string | undefined>)[name] ?? "";
}

function parseId(value: unknown, message: string): string {
  const parsed = resourceIdSchema.safeParse(value);
  if (!parsed.success) throw new ApiProblem("NOT_FOUND", message);
  return parsed.data;
}

export function createFormsRouter(options: {
  repository: FormRepository;
  resolveWorkspace: WorkspaceResolver;
}): Router {
  const { repository, resolveWorkspace } = options;
  const router = Router({ mergeParams: true });

  router.get("/", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      const projectId = parseId(param(req, "projectId"), "Project not found");

      res.json({ data: await repository.list(context, projectId) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:edit");
      const projectId = parseId(param(req, "projectId"), "Project not found");

      const parsed = formDefinitionInputSchema.safeParse(req.body);
      if (!parsed.success) throw new ApiProblem("VALIDATION_ERROR", "That form definition is not valid");

      res.status(201).json({ data: await repository.create(context, projectId, parsed.data) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:formId", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      const projectId = parseId(param(req, "projectId"), "Project not found");
      const form = await repository.findById(context, projectId, param(req, "formId"));

      if (form === null) throw new ApiProblem("NOT_FOUND", "Form not found");
      res.json({ data: form });
    } catch (error) {
      next(error);
    }
  });

  router.put("/:formId", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:edit");
      const projectId = parseId(param(req, "projectId"), "Project not found");

      const parsed = formDefinitionUpdateSchema.safeParse(req.body);
      if (!parsed.success) throw new ApiProblem("VALIDATION_ERROR", "That form definition is not valid");

      const { expectedRevision, ...definition } = parsed.data;
      const updated = await repository.update(context, projectId, param(req, "formId"), definition, {
        expectedRevision,
      });
      if (updated === null) throw new ApiProblem("NOT_FOUND", "Form not found");
      res.json({ data: updated });
    } catch (error) {
      next(mapFormError(error));
    }
  });

  router.delete("/:formId", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:edit");
      const projectId = parseId(param(req, "projectId"), "Project not found");

      // Archived rather than deleted where submissions exist: removing the last block that shows a
      // form must never take the answers people already sent with it.
      const outcome = await repository.removeOrArchive(context, projectId, param(req, "formId"));
      if (outcome === null) throw new ApiProblem("NOT_FOUND", "Form not found");

      res.json({ data: outcome });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
