import { cmsCollectionInputSchema, cmsItemInputSchema, resourceIdSchema } from "@websitebuilder/shared";
import { Router } from "express";
import { z } from "zod";

import { ApiProblem, zodProblem } from "../../middleware/errors";
import type { WorkspaceResolver } from "../projects/routes";
import { CmsError, type CmsRepository } from "./repository";

/**
 * CMS endpoints, mounted beneath `/workspaces/:workspaceId/projects/:projectId/cms`.
 *
 * Reading is a project read; anything that changes a schema or an item requires `project:edit`.
 * A blocked schema change answers 409 with the issues, because the caller needs to know which
 * items stand in the way rather than only that something failed.
 */
function param(req: { params: unknown }, name: string): string {
  return (req.params as Record<string, string | undefined>)[name] ?? "";
}

function parseId(value: unknown, message: string): string {
  const parsed = resourceIdSchema.safeParse(value);
  if (!parsed.success) throw new ApiProblem("NOT_FOUND", message);
  return parsed.data;
}

const collectionBodySchema = cmsCollectionInputSchema.extend({ hasDetailRoute: z.boolean().optional() });

const templateBodySchema = z
  .object({
    draftSections: z.array(z.unknown()).max(50),
    seo: z
      .object({
        titleFieldId: z.string().min(1).optional(),
        descriptionFieldId: z.string().min(1).optional(),
        imageFieldId: z.string().min(1).optional(),
      })
      .strict(),
  })
  .strict();

export function createCmsRouter(options: {
  repository: CmsRepository;
  resolveWorkspace: WorkspaceResolver;
}): Router {
  const { repository, resolveWorkspace } = options;
  const router = Router({ mergeParams: true });

  const projectOf = (req: { params: unknown }) => parseId(param(req, "projectId"), "Project not found");

  router.get("/collections", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      res.json({ data: await repository.listCollections(context, projectOf(req)) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/collections", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:edit");
      const parsed = collectionBodySchema.safeParse(req.body);
      if (!parsed.success) throw zodProblem(parsed.error);

      res.status(201).json({ data: await repository.createCollection(context, projectOf(req), parsed.data) });
    } catch (error) {
      next(toProblem(error));
    }
  });

  router.put("/collections/:collectionId", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:edit");
      const parsed = collectionBodySchema.safeParse(req.body);
      if (!parsed.success) throw zodProblem(parsed.error);

      const result = await repository.updateCollection(
        context,
        projectOf(req),
        parseId(param(req, "collectionId"), "Collection not found"),
        parsed.data,
      );

      // Non-blocking issues travel with the success: the change was applied and the caller still
      // needs to know what it touched.
      res.json({ data: result.collection, meta: { issues: result.issues } });
    } catch (error) {
      next(toProblem(error));
    }
  });

  router.delete("/collections/:collectionId", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:edit");
      const removed = await repository.deleteCollection(
        context,
        projectOf(req),
        parseId(param(req, "collectionId"), "Collection not found"),
      );
      if (!removed) throw new ApiProblem("NOT_FOUND", "Collection not found");

      res.status(204).end();
    } catch (error) {
      next(toProblem(error));
    }
  });

  router.get("/collections/:collectionId/template", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      res.json({
        data: await repository.findTemplate(
          context,
          projectOf(req),
          parseId(param(req, "collectionId"), "Collection not found"),
        ),
      });
    } catch (error) {
      next(toProblem(error));
    }
  });

  router.put("/collections/:collectionId/template", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:edit");
      const parsed = templateBodySchema.safeParse(req.body);
      if (!parsed.success) throw zodProblem(parsed.error);

      res.json({
        data: await repository.saveTemplateDraft(
          context,
          projectOf(req),
          parseId(param(req, "collectionId"), "Collection not found"),
          parsed.data,
        ),
      });
    } catch (error) {
      next(toProblem(error));
    }
  });

  // Publishing a template is its own action because it changes every item at once. Nothing else in
  // the CMS has that reach, and saving a draft must never do it by accident.
  router.post("/collections/:collectionId/template/publish", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "publish:execute");
      res.json({
        data: await repository.publishTemplate(
          context,
          projectOf(req),
          parseId(param(req, "collectionId"), "Collection not found"),
        ),
      });
    } catch (error) {
      next(toProblem(error));
    }
  });

  router.get("/collections/:collectionId/items", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      const status = req.query.status === "draft" || req.query.status === "published" ? req.query.status : undefined;

      res.json({
        data: await repository.listItems(
          context,
          projectOf(req),
          parseId(param(req, "collectionId"), "Collection not found"),
          {
            ...(status === undefined ? {} : { status }),
            ...(typeof req.query.search === "string" ? { search: req.query.search } : {}),
            page: Number(req.query.page ?? 1),
            perPage: Number(req.query.perPage ?? 25),
          },
        ),
      });
    } catch (error) {
      next(toProblem(error));
    }
  });

  router.post("/collections/:collectionId/items", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:edit");
      const parsed = cmsItemInputSchema.safeParse(req.body);
      if (!parsed.success) throw zodProblem(parsed.error);

      res.status(201).json({
        data: await repository.createItem(
          context,
          projectOf(req),
          parseId(param(req, "collectionId"), "Collection not found"),
          parsed.data,
        ),
      });
    } catch (error) {
      next(toProblem(error));
    }
  });

  router.put("/items/:itemId", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:edit");
      const parsed = cmsItemInputSchema.safeParse(req.body);
      if (!parsed.success) throw zodProblem(parsed.error);

      res.json({
        data: await repository.updateItem(
          context,
          projectOf(req),
          parseId(param(req, "itemId"), "Item not found"),
          parsed.data,
        ),
      });
    } catch (error) {
      next(toProblem(error));
    }
  });

  router.post("/items/:itemId/duplicate", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:edit");
      res.status(201).json({
        data: await repository.duplicateItem(context, projectOf(req), parseId(param(req, "itemId"), "Item not found")),
      });
    } catch (error) {
      next(toProblem(error));
    }
  });

  router.delete("/items/:itemId", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:edit");
      const removed = await repository.deleteItem(
        context,
        projectOf(req),
        parseId(param(req, "itemId"), "Item not found"),
      );
      if (!removed) throw new ApiProblem("NOT_FOUND", "Item not found");

      res.status(204).end();
    } catch (error) {
      next(toProblem(error));
    }
  });

  return router;
}

/** Repository reasons become API problems here, so no route repeats the mapping. */
function toProblem(error: unknown): unknown {
  if (!(error instanceof CmsError)) return error;

  if (error.reason === "not-found") return new ApiProblem("NOT_FOUND", "Not found");
  if (error.reason === "slug-taken") return new ApiProblem("VALIDATION_ERROR", "That address is already used");
  if (error.reason === "schema-change-blocked") {
    return new ApiProblem(
      "VALIDATION_ERROR",
      "This change would leave published items without a required value",
      error.issues.map((issue) => ({ path: "fields", message: JSON.stringify(issue) })),
    );
  }
  return new ApiProblem(
    "VALIDATION_ERROR",
    "Some values do not match this collection",
    error.issues.map((issue) => ({ path: "values", message: JSON.stringify(issue) })),
  );
}
