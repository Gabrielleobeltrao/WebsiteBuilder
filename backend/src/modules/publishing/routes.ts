import { API_BASE_PATH, FORM_RESULT_PARAMS, resourceIdSchema, SUPPORTED_APP_LOCALES } from "@websitebuilder/shared";
import express, { Router } from "express";
import { ObjectId } from "mongodb";

import { ApiProblem } from "../../middleware/errors";
import { DRAFT_PREVIEW_CSP } from "../../renderer/app";
import { RUNTIME_SOURCE, RUNTIME_VERSION } from "../../renderer/runtime.generated";
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
  /** The runtime file, on this origin, so a framed preview can load it under the same policy. */
  router.get("/runtime.js", (_req, res) => {
    res
      .status(200)
      .type("application/javascript; charset=utf-8")
      .set("cache-control", "public, max-age=31536000, immutable")
      .set("x-content-type-options", "nosniff")
      .send(RUNTIME_SOURCE);
  });

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
        // Same file, same decision rule as the published page: a preview that omitted it would
        // rehearse static markup rather than the behaviour a visitor gets.
        runtimeSrc: `${API_BASE_PATH}/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/publishing/runtime.js?v=${RUNTIME_VERSION}`,
        pageHref: (target) => `${base}?path=${encodeURIComponent(target)}`,
        mediaBaseUrl: `${API_BASE_PATH}/workspaces/${encodeURIComponent(workspaceId)}/media`,
        canonicalOrigin: publicOrigin,
        // Posts back to this router's own rehearsal endpoint, not to the public one. Same origin as
        // the frame, so the policy above admits it.
        formAction: (formId) => `${base.replace(/\/preview$/, "")}/preview/forms/${encodeURIComponent(formId)}`,
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

  /**
   * Preview of a blog layout, against representative posts.
   *
   * It sits on this router rather than the blog's because it is the same render as the draft
   * preview — the same renderer, the same responsive CSS, the same policy headers, the same frame.
   * Duplicating that on another router would give the template a second rendering path, which is
   * exactly how a preview stops predicting what publication will do.
   */
  router.get("/preview/blog-template/:kind", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      const projectId = parseId(param(req, "projectId"), "Project not found");
      const workspaceId = param(req, "workspaceId");

      const kind = param(req, "kind");
      if (kind !== "index" && kind !== "article") throw new ApiProblem("VALIDATION_ERROR", "Unknown template kind");

      // The reader's own language. Sample copy is content on the page, so it is rendered by the
      // backend and cannot reach the application's locale resources.
      const requested = typeof req.query.lang === "string" ? req.query.lang : "";
      const locale = (SUPPORTED_APP_LOCALES as readonly string[]).includes(requested)
        ? (requested as (typeof SUPPORTED_APP_LOCALES)[number])
        : "en-US";

      const base = `${API_BASE_PATH}/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/publishing/preview`;

      const result = await service.previewRoute(context, projectId, {
        // Replaced by the sample's own path; a template preview is not addressed by URL.
        path: "/",
        sample: { kind, locale },
        runtimeSrc: `${API_BASE_PATH}/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/publishing/runtime.js?v=${RUNTIME_VERSION}`,
        pageHref: (target) => `${base}?path=${encodeURIComponent(target)}`,
        mediaBaseUrl: `${API_BASE_PATH}/workspaces/${encodeURIComponent(workspaceId)}/media`,
        canonicalOrigin: publicOrigin,
        formAction: (formId) => `${base.replace(/\/preview$/, "")}/preview/forms/${encodeURIComponent(formId)}`,
      });
      if (result === null) throw new ApiProblem("NOT_FOUND", "Project not found");

      res
        .status(result.status)
        .set("content-type", "text/html; charset=utf-8")
        .set("content-security-policy", DRAFT_PREVIEW_CSP)
        .set("x-robots-tag", "noindex, nofollow")
        .set("cache-control", "private, no-store")
        .set("referrer-policy", "no-referrer")
        .send(result.html);
    } catch (error) {
      next(error);
    }
  });

  /**
   * A rehearsed submission.
   *
   * Runs the real validation against the draft definition and stores nothing — no record, no
   * notification, no counter. That is the whole contract: a designer has to be able to fill their
   * own form in and watch it behave without their inbox filling with their own testing.
   *
   * Authenticated like every other route on this router, so it is not a public write path wearing
   * a preview label.
   */
  router.post("/preview/forms/:formId", express.urlencoded({ extended: false, limit: "64kb" }), async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      const projectId = parseId(param(req, "projectId"), "Project not found");

      const outcome = await service.previewSubmission(context, projectId, param(req, "formId"), req.body ?? {});
      if (outcome === null) throw new ApiProblem("NOT_FOUND", "Form not found");

      const back = typeof req.query.path === "string" && req.query.path.startsWith("/") ? req.query.path : "/";
      const marker = outcome.accepted ? FORM_RESULT_PARAMS.ok : FORM_RESULT_PARAMS.error;
      const workspaceId = param(req, "workspaceId");
      const base = `${API_BASE_PATH}/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/publishing/preview`;

      res.redirect(303, `${base}?path=${encodeURIComponent(back)}&${marker}=${encodeURIComponent(param(req, "formId"))}`);
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
