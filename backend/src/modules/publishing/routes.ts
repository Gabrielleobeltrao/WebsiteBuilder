import { resourceIdSchema } from "@websitebuilder/shared";
import { Router } from "express";

import { ApiProblem } from "../../middleware/errors";
import type { WorkspaceResolver } from "../projects/routes";
import { PublishError, type PublishingRepository } from "./repository";
import type { PublishingService } from "./service";

/**
 * Publishing endpoints, mounted beneath `/workspaces/:workspaceId/projects/:projectId/publishing`.
 *
 * Reading history is a read; changing what the public sees requires `publish:execute`, and domain
 * changes require `domain:manage`. The router is mounted with the weakest of those, so each route
 * that does more names its own permission.
 */
function param(req: { params: unknown }, name: string): string {
  return (req.params as Record<string, string | undefined>)[name] ?? "";
}

function parseId(value: unknown, message: string): string {
  const parsed = resourceIdSchema.safeParse(value);
  if (!parsed.success) throw new ApiProblem("NOT_FOUND", message);
  return parsed.data;
}

export function createPublishingRouter(options: {
  service: PublishingService;
  repository: PublishingRepository;
  resolveWorkspace: WorkspaceResolver;
  platformRootDomain: string;
  reservedSubdomains: readonly string[];
}): Router {
  const { service, repository, resolveWorkspace, platformRootDomain, reservedSubdomains } = options;
  const router = Router({ mergeParams: true });

  router.get("/preflight", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      const projectId = parseId(param(req, "projectId"), "Project not found");

      const result = await service.preflight(context, projectId);
      if (result === null) throw new ApiProblem("NOT_FOUND", "Project not found");

      res.json({ data: { report: result.report, contentHash: result.snapshot?.contentHash ?? null } });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "publish:execute");
      const projectId = parseId(param(req, "projectId"), "Project not found");

      const outcome = await service.publish(context, projectId);

      if (outcome.status === "not-found") throw new ApiProblem("NOT_FOUND", "Project not found");
      if (outcome.status === "blocked") {
        // 422: the request was understood and the site is simply not publishable yet.
        res.status(422).json({ error: { code: "PUBLISH_BLOCKED", message: "This site cannot be published yet" }, data: outcome.report });
        return;
      }
      if (outcome.status === "conflict") {
        throw new ApiProblem("REVISION_CONFLICT", "The project changed while it was being published");
      }

      res.status(outcome.unchanged ? 200 : 201).json({
        data: { version: outcome.version, unchanged: outcome.unchanged },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/versions", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      const projectId = parseId(param(req, "projectId"), "Project not found");
      res.json({ data: await repository.history(context, projectId) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/versions/:versionId/rollback", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "publish:execute");
      const projectId = parseId(param(req, "projectId"), "Project not found");
      const versionId = parseId(param(req, "versionId"), "Version not found");

      res.json({ data: await repository.rollback(context, projectId, versionId) });
    } catch (error) {
      next(error instanceof PublishError ? new ApiProblem("NOT_FOUND", "Version not found") : error);
    }
  });

  router.get("/domains", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      const projectId = parseId(param(req, "projectId"), "Project not found");
      res.json({ data: await repository.listDomains(context, projectId) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/domains/platform", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "domain:manage");
      const projectId = parseId(param(req, "projectId"), "Project not found");

      const slug = typeof req.body?.slug === "string" ? req.body.slug : "";
      const domain = await repository.ensurePlatformDomain(
        context,
        projectId,
        slug,
        platformRootDomain,
        reservedSubdomains,
      );
      if (domain === null) throw new ApiProblem("VALIDATION_ERROR", "This address cannot be used");

      res.status(201).json({ data: domain });
    } catch (error) {
      next(
        error instanceof PublishError
          ? new ApiProblem("VALIDATION_ERROR", "This address is already taken")
          : error,
      );
    }
  });

  router.post("/domains/:domainId/primary", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "domain:manage");
      const projectId = parseId(param(req, "projectId"), "Project not found");
      const domainId = parseId(param(req, "domainId"), "Domain not found");

      const domain = await repository.setPrimaryDomain(context, projectId, domainId);
      if (domain === null) throw new ApiProblem("VALIDATION_ERROR", "Only a live domain can be the primary address");

      res.json({ data: domain });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
