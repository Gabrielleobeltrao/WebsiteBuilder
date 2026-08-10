import {
  builderDocumentInputSchema,
  createProjectInputSchema,
  renameProjectInputSchema,
  resourceIdSchema,
  projectSlugSchema,
} from "@websitebuilder/shared";
import { Router, type RequestHandler } from "express";
import { z } from "zod";

import { ApiProblem, zodProblem } from "../../middleware/errors";
import type { Permission } from "../workspaces/permissions";
import type { WorkspaceContext } from "./repository";
import { ProjectRepository, RevisionConflictError, SlugTakenError } from "./repository";
import { reconcileSiteStatus, type ModuleFacts } from "./status";
import type { SiteFeatureKey } from "@websitebuilder/shared";

/**
 * Resolves the verified tenant context for a request. Phase 7 replaces the seeded implementation
 * with Better Auth session plus organization membership; the route contract does not change,
 * because routes never read a workspace ID from the body or a header themselves.
 */
export type WorkspaceResolver = (
  req: Parameters<RequestHandler>[0],
  required?: Permission,
) => Promise<WorkspaceContext>;

const saveDocumentBodySchema = z
  .object({ revision: z.number().int().nonnegative(), document: builderDocumentInputSchema })
  .strict();

function parseProjectId(value: unknown): string {
  const parsed = resourceIdSchema.safeParse(value);
  // A malformed ID is answered as "not found", not "invalid": probing IDs must not reveal which
  // shapes exist.
  if (!parsed.success) throw new ApiProblem("NOT_FOUND", "Project not found");
  return parsed.data;
}

export function createProjectsRouter(options: {
  repository: ProjectRepository;
  resolveWorkspace: WorkspaceResolver;
  /**
   * Reads each optional module's own records. Injected so the projection is assembled from real
   * sources rather than from anything the caller sends.
   */
  collectModuleFacts?: (input: {
    workspaceId: string;
    projectId: string;
  }) => Promise<Partial<Record<SiteFeatureKey, ModuleFacts>>>;
}): Router {
  const { repository, resolveWorkspace, collectModuleFacts } = options;
  // mergeParams: the router is mounted under /workspaces/:workspaceId.
  const router = Router({ mergeParams: true });

  router.get("/", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      const clientId = typeof req.query.clientId === "string" ? req.query.clientId : undefined;
      res.json({ data: await repository.listSummaries(context, clientId ? { clientId } : {}) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:create");
      const parsed = createProjectInputSchema.safeParse(req.body);
      if (!parsed.success) throw zodProblem(parsed.error);

      const project = await repository.create(context, parsed.data);
      res.status(201).json({ data: project });
    } catch (error) {
      next(mapDomainError(error));
    }
  });

  router.get("/:projectId", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      const project = await repository.findById(context, parseProjectId(req.params.projectId));
      if (project === null) throw new ApiProblem("NOT_FOUND", "Project not found");
      res.json({ data: project });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:projectId/status", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      const projectId = parseProjectId(req.params.projectId);
      const project = await repository.findById(context, projectId);
      if (project === null) throw new ApiProblem("NOT_FOUND", "Project not found");

      const facts = (await collectModuleFacts?.({ workspaceId: context.workspaceId, projectId })) ?? {};
      res.json({ data: reconcileSiteStatus({ project, facts }) });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:projectId", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:edit");
      const parsed = renameProjectInputSchema.safeParse(req.body);
      if (!parsed.success) throw zodProblem(parsed.error);

      const project = await repository.rename(context, parseProjectId(req.params.projectId), parsed.data.name);
      if (project === null) throw new ApiProblem("NOT_FOUND", "Project not found");
      res.json({ data: project });
    } catch (error) {
      next(mapDomainError(error));
    }
  });

  router.put("/:projectId/document", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:edit");
      const parsed = saveDocumentBodySchema.safeParse(req.body);
      if (!parsed.success) throw zodProblem(parsed.error);

      const projectId = parseProjectId(req.params.projectId);
      const existing = await repository.findById(context, projectId);
      if (existing === null) throw new ApiProblem("NOT_FOUND", "Project not found");

      // The slug is part of the public hostname; changing it is its own authorised operation.
      if (parsed.data.document.slug !== existing.slug) {
        throw new ApiProblem("VALIDATION_ERROR", "Project slug cannot be changed through the document endpoint", [
          { path: "document.slug", message: "must match the stored project slug" },
        ]);
      }
      if (!projectSlugSchema.safeParse(parsed.data.document.slug).success) {
        throw new ApiProblem("VALIDATION_ERROR", "Project slug is not a valid platform hostname label");
      }

      const project = await repository.saveDocument(context, projectId, parsed.data.revision, parsed.data.document);
      res.json({ data: project });
    } catch (error) {
      next(mapDomainError(error));
    }
  });

  router.delete("/:projectId", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:delete");
      const deleted = await repository.delete(context, parseProjectId(req.params.projectId));
      if (!deleted) throw new ApiProblem("NOT_FOUND", "Project not found");
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function mapDomainError(error: unknown): unknown {
  if (error instanceof RevisionConflictError) {
    return new ApiProblem("REVISION_CONFLICT", "Document was modified after it was loaded", [
      { path: "revision", message: `current revision is ${error.currentRevision}` },
    ]);
  }
  if (error instanceof SlugTakenError) {
    return new ApiProblem("SLUG_TAKEN", "That address is already in use");
  }
  return error;
}
