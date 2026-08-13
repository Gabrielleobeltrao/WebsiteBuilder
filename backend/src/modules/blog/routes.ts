import { BLOG_FORMATS, blogPostInputSchema, blogSettingsSchema, resourceIdSchema } from "@websitebuilder/shared";
import { Router } from "express";
import { z } from "zod";

import { ApiProblem, zodProblem } from "../../middleware/errors";
import type { WorkspaceResolver } from "../projects/routes";
import { BlogRepository, SlugTakenError } from "./repository";
import type { TemplateRepository } from "./templates";

/** A blog is turned on with a format chosen, never without one. */
const activationSchema = z.object({ format: z.enum(BLOG_FORMATS) }).strict();

/**
 * Blog endpoints, mounted beneath `/workspaces/:workspaceId/projects/:projectId/blog`.
 *
 * Public read endpoints live on a separate router with no workspace prefix: they resolve published
 * content only and must never accept a workspace as a hint about what the caller may see.
 */
/**
 * Reads a route parameter from a `mergeParams` router, whose params Express types as `{}` because
 * they come from a parent it cannot see.
 */
function param(req: { params: unknown }, name: string): string {
  const params = req.params as Record<string, string | undefined>;
  return params[name] ?? "";
}

function parseProjectId(value: unknown): string {
  const parsed = resourceIdSchema.safeParse(value);
  if (!parsed.success) throw new ApiProblem("NOT_FOUND", "Project not found");
  return parsed.data;
}

export function createBlogRouter(options: {
  repository: BlogRepository;
  resolveWorkspace: WorkspaceResolver;
  /**
   * The template store, so turning a blog on can create the pages its routes need.
   *
   * Injected rather than imported: templates are their own module, and the blog router's job is to
   * make sure a blog that is on is a blog that can serve something.
   */
  templates?: TemplateRepository;
}): Router {
  const { repository, resolveWorkspace, templates } = options;
  const router = Router({ mergeParams: true });

  /**
   * Turns the blog on, with a format, in one step.
   *
   * The separate settings PUT could set `enabled` and leave both template ids undefined, and that is
   * exactly what the product did: a blog turned on that way reported a blocking setup issue for the
   * rest of the project's life, because nothing anywhere ever set those ids — and the issue blocks
   * publication of the whole site, not just the blog.
   *
   * So activation creates both templates and points the settings at them. A blog that is on is a
   * blog that can serve its own routes, by construction rather than by the operator remembering.
   */
  router.post("/activate", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:edit");
      const projectId = parseProjectId(param(req, "projectId"));

      const parsed = activationSchema.safeParse(req.body);
      if (!parsed.success) throw zodProblem(parsed.error);
      if (templates === undefined) throw new ApiProblem("SERVICE_UNAVAILABLE", "Templates are not available");

      const current = await repository.loadSettings(context, projectId);
      const [index, article] = await Promise.all([
        templates.loadOrCreate(context, projectId, "index"),
        templates.loadOrCreate(context, projectId, "article"),
      ]);

      /*
       * The starters are published as well as created.
       *
       * A template that exists only as a draft renders nothing publicly, and until a template editor
       * exists there is nowhere to press publish. Publishing a starter page nobody has edited yet
       * carries no risk — there is no earlier version of it to overwrite — and it is what makes the
       * blog's routes serve something the moment it is turned on.
       */
      await Promise.all([
        templates.publish(context, projectId, "index", []),
        templates.publish(context, projectId, "article", []),
      ]);

      const settings = await repository.saveSettings(context, projectId, {
        ...current,
        enabled: true,
        format: parsed.data.format,
        indexTemplateId: index.id,
        articleTemplateId: article.id,
      });

      res.json({ data: settings });
    } catch (error) {
      next(error);
    }
  });

  router.get("/settings", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      res.json({ data: await repository.loadSettings(context, parseProjectId(param(req, "projectId"))) });
    } catch (error) {
      next(error);
    }
  });

  router.put("/settings", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:edit");
      const parsed = blogSettingsSchema.safeParse(req.body);
      if (!parsed.success) throw zodProblem(parsed.error);

      res.json({ data: await repository.saveSettings(context, parseProjectId(param(req, "projectId")), parsed.data) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/posts", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      const status = req.query.status === "draft" || req.query.status === "published" ? req.query.status : undefined;

      res.json({
        data: await repository.list(context, parseProjectId(param(req, "projectId")), {
          ...(status ? { status } : {}),
          ...(typeof req.query.search === "string" ? { search: req.query.search } : {}),
          ...(typeof req.query.categoryId === "string" ? { categoryId: req.query.categoryId } : {}),
          page: Number.parseInt(String(req.query.page ?? "1"), 10) || 1,
          perPage: Number.parseInt(String(req.query.perPage ?? "20"), 10) || 20,
        }),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/posts", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:edit");
      const parsed = blogPostInputSchema.safeParse(req.body);
      if (!parsed.success) throw zodProblem(parsed.error);

      const created = await repository.create(context, parseProjectId(param(req, "projectId")), parsed.data);
      res.status(201).json({ data: created });
    } catch (error) {
      next(mapBlogError(error));
    }
  });

  router.get("/posts/:postId", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      const post = await repository.findById(
        context,
        parseProjectId(param(req, "projectId")),
        param(req, "postId"),
      );
      if (post === null) throw new ApiProblem("NOT_FOUND", "Post not found");
      res.json({ data: post });
    } catch (error) {
      next(error);
    }
  });

  router.put("/posts/:postId", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:edit");
      const parsed = blogPostInputSchema.safeParse(req.body);
      if (!parsed.success) throw zodProblem(parsed.error);

      const updated = await repository.update(
        context,
        parseProjectId(param(req, "projectId")),
        param(req, "postId"),
        parsed.data,
      );
      if (updated === null) throw new ApiProblem("NOT_FOUND", "Post not found");
      res.json({ data: updated });
    } catch (error) {
      next(mapBlogError(error));
    }
  });

  for (const [path, status] of [
    ["/posts/:postId/publish", "published"],
    ["/posts/:postId/unpublish", "draft"],
  ] as const) {
    router.post(path, async (req, res, next) => {
      try {
        const context = await resolveWorkspace(req, "project:edit");
        const updated = await repository.setStatus(
          context,
          parseProjectId(param(req, "projectId")),
          param(req, "postId"),
          status,
        );
        if (updated === null) throw new ApiProblem("NOT_FOUND", "Post not found");
        res.json({ data: updated });
      } catch (error) {
        next(error);
      }
    });
  }

  router.delete("/posts/:postId", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:edit");
      const deleted = await repository.delete(
        context,
        parseProjectId(param(req, "projectId")),
        param(req, "postId"),
      );
      if (!deleted) throw new ApiProblem("NOT_FOUND", "Post not found");
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

/**
 * Public blog reads. No authentication and no workspace: identity comes from the project in the
 * path, and only published posts are ever returned.
 */
export function createPublicBlogRouter(options: { repository: BlogRepository }): Router {
  const { repository } = options;
  const router = Router({ mergeParams: true });

  router.get("/posts", async (req, res, next) => {
    try {
      const projectId = parseProjectId(param(req, "projectId"));
      res.json({
        data: await repository.listPublished(projectId, {
          page: Number.parseInt(String(req.query.page ?? "1"), 10) || 1,
          perPage: Number.parseInt(String(req.query.perPage ?? "12"), 10) || 12,
        }),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/posts/:slug", async (req, res, next) => {
    try {
      const projectId = parseProjectId(param(req, "projectId"));
      const post = await repository.findPublishedBySlug(projectId, param(req, "slug"));
      if (post === null) throw new ApiProblem("NOT_FOUND", "Post not found");

      // Ownership fields are internal; a public reader has no use for them and no right to them.
      const { workspaceId: _w, createdByUserId: _c, ...publicPost } = post;
      res.json({ data: publicPost });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function mapBlogError(error: unknown): unknown {
  return error instanceof SlugTakenError
    ? new ApiProblem("SLUG_TAKEN", "That address is already used by another post")
    : error;
}
