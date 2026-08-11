import { analyticsSettingsSchema, renderCsv } from "@websitebuilder/shared";
import { Router } from "express";

import { ApiProblem } from "../../middleware/errors";
import type { WorkspaceResolver } from "../projects/routes";
import type { AnalyticsQueries } from "./queries";
import type { AnalyticsRepository } from "./repository";

/**
 * The authenticated analytics surface.
 *
 * Every route resolves the workspace from a verified session before touching a collection, and the
 * project comes from the URL rather than from a body — so a request can name a project it may not
 * see, and get that project's absence rather than its data.
 */
export function createAnalyticsRouter(options: {
  repository: AnalyticsRepository;
  queries: AnalyticsQueries;
  resolveWorkspace: WorkspaceResolver;
}): Router {
  const { repository, queries, resolveWorkspace } = options;
  const router = Router({ mergeParams: true });

  /** The project this request is for, taken from the path and never from the payload. */
  const projectIdOf = (params: Record<string, string | undefined>): string => {
    const projectId = params["projectId"];
    if (typeof projectId !== "string" || projectId.length === 0) {
      throw new ApiProblem("NOT_FOUND", "Project not found");
    }
    return projectId;
  };

  router.get("/settings", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      res.json({ data: await repository.loadSettings(context, projectIdOf(req.params)) });
    } catch (error) {
      next(error);
    }
  });

  router.put("/settings", async (req, res, next) => {
    try {
      // Editing what a site collects from its visitors is a change to what that site promises them,
      // so it needs the permission that lets someone change the site itself.
      const context = await resolveWorkspace(req, "project:edit");
      const settings = analyticsSettingsSchema.safeParse(req.body);
      if (!settings.success) throw new ApiProblem("VALIDATION_ERROR", "Those analytics settings are not valid");

      res.json({ data: await repository.saveSettings(context, projectIdOf(req.params), settings.data) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/overview", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      res.json({ data: await queries.overview(context, projectIdOf(req.params), req.query) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/pages", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      res.json({ data: await queries.pages(context, projectIdOf(req.params), req.query) });
    } catch (error) {
      next(error);
    }
  });

  /**
   * The layout a heatmap is drawn over.
   *
   * The dashboard renders it with the same component that produced the published page, so the
   * overlay's coordinates land where they were recorded. It is served here rather than framing the
   * live site: published pages set `frame-ancestors 'none'`, and a cross-origin frame could not be
   * measured for alignment even if they did not.
   */
  router.get("/snapshot/:versionId", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      const snapshot = await queries.snapshot(context, projectIdOf(req.params), req.params["versionId"] ?? "");
      if (snapshot === null) throw new ApiProblem("NOT_FOUND", "That published version is no longer available");

      res.json({ data: snapshot });
    } catch (error) {
      next(error);
    }
  });

  router.get("/heatmap", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      res.json({ data: await queries.heatmap(context, projectIdOf(req.params), req.query) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/vitals", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      res.json({ data: await queries.vitals(context, projectIdOf(req.params), req.query) });
    } catch (error) {
      next(error);
    }
  });

  /**
   * The aggregate numbers as a spreadsheet.
   *
   * Escaping goes through the shared CSV writer, which neutralises formula injection — analytics
   * rows carry page paths and referrer hosts, which are exactly the untrusted strings that make a
   * download dangerous to open.
   */
  router.get("/export.csv", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      const projectId = projectIdOf(req.params);
      const report = await queries.pages(context, projectId, req.query);

      const rows = report.pages.map((page) => [
        page.path,
        String(page.views),
        String(page.clicks),
        String(page.scroll[50] ?? 0),
        String(page.scroll[90] ?? 0),
      ]);

      res
        .status(200)
        .type("text/csv; charset=utf-8")
        .set("content-disposition", `attachment; filename="analytics-${projectId}.csv"`)
        // A spreadsheet of a customer's traffic is not something a shared cache should keep.
        .set("cache-control", "no-store")
        .send(renderCsv([["path", "views", "clicks", "reached_50_percent", "reached_90_percent"], ...rows]));
    } catch (error) {
      next(error);
    }
  });

  /**
   * Deletes everything measured for one project.
   *
   * Synchronous and scoped: there is no background infrastructure in this backend, and building a
   * job queue to avoid one bounded `deleteMany` per collection would be a subsystem in place of a
   * statement. Server-counted views go too — a customer asking to delete their analytics means all
   * of it, not the part that happens to need no consent.
   */
  router.delete("/data", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:delete");
      res.json({ data: { deleted: await repository.deleteProjectData(context, projectIdOf(req.params)) } });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
