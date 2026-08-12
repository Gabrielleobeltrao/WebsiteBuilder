import { API_BASE_PATH, resourceIdSchema } from "@websitebuilder/shared";
import { Router } from "express";
import { ObjectId } from "mongodb";

import { ApiProblem } from "../../middleware/errors";
import { DRAFT_PREVIEW_CSP } from "../../renderer/app";
import type { WorkspaceResolver } from "../projects/routes";
import type { DomainService } from "../domains/service";
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
  domains: DomainService;
  resolveWorkspace: WorkspaceResolver;
  platformRootDomain: string;
  reservedSubdomains: readonly string[];
  /** Origin the preview reports as canonical. Never used to fetch anything. */
  publicOrigin: string;
}): Router {
  const { service, repository, domains, resolveWorkspace, platformRootDomain, reservedSubdomains, publicOrigin } =
    options;
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

  /**
   * The draft, as HTML, for the builder's preview frame.
   *
   * Same-origin with the application so the session cookie authorises it, and behind the same
   * workspace resolution as every other business route — a draft is not public, and this is the one
   * place its unpublished content leaves the database.
   */
  router.get("/preview", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      const projectId = parseId(param(req, "projectId"), "Project not found");
      const workspaceId = param(req, "workspaceId");

      const requested = typeof req.query.path === "string" ? req.query.path : "/";
      // Only a path, never an origin: a caller cannot turn this into an open redirect or make the
      // renderer resolve links against somewhere else.
      const path = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";

      const base = `${API_BASE_PATH}/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/publishing/preview`;

      const result = await service.previewRoute(context, projectId, {
        path,
        pageHref: (target) => `${base}?path=${encodeURIComponent(target)}`,
        mediaBaseUrl: `${API_BASE_PATH}/workspaces/${encodeURIComponent(workspaceId)}/media`,
        canonicalOrigin: publicOrigin,
      });
      if (result === null) throw new ApiProblem("NOT_FOUND", "Project not found");

      res
        .status(result.status)
        .set("content-type", "text/html; charset=utf-8")
        .set("content-security-policy", DRAFT_PREVIEW_CSP)
        // A draft is nobody's search result, and it must not sit in a shared cache.
        .set("x-robots-tag", "noindex, nofollow")
        .set("cache-control", "private, no-store")
        .set("referrer-policy", "no-referrer")
        .send(result.html);
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

  router.post("/domains/custom", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "domain:manage");
      const projectId = parseId(param(req, "projectId"), "Project not found");
      const hostname = typeof req.body?.hostname === "string" ? req.body.hostname : "";

      const outcome = await domains.connect(context, projectId, hostname);
      if (outcome.status === "rejected") {
        throw new ApiProblem("VALIDATION_ERROR", rejectionMessage(outcome.reason));
      }

      // A provider outage still returns the stored claim: the customer keeps their place and the
      // instructions arrive on the next refresh.
      res.status(201).json({ data: { domain: outcome.domain, providerReachable: outcome.status === "connected" } });
    } catch (error) {
      next(error);
    }
  });

  router.post("/domains/:domainId/refresh", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "domain:manage");
      const domainId = parseId(param(req, "domainId"), "Domain not found");

      const domain = await domains.refresh(context, new ObjectId(domainId));
      if (domain === null) throw new ApiProblem("NOT_FOUND", "Domain not found");

      res.json({ data: domain });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/domains/:domainId", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "domain:manage");
      const domainId = parseId(param(req, "domainId"), "Domain not found");

      if (!(await domains.disconnect(context, new ObjectId(domainId)))) {
        throw new ApiProblem("NOT_FOUND", "Domain not found");
      }

      res.status(204).end();
    } catch (error) {
      next(error);
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

function rejectionMessage(reason: "invalid-hostname" | "already-connected" | "platform-domain"): string {
  if (reason === "platform-domain") return "This address belongs to the platform and cannot be connected";
  // One message for a hostname taken by this project and one taken by another customer: which
  // tenant owns a domain is not disclosed here.
  if (reason === "already-connected") return "This address is already connected";
  return "This is not a valid address";
}
