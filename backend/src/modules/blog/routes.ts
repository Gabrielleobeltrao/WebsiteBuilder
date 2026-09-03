import {
  BLOG_FORMATS,
  blogFieldDefinitionSchema,
  blogPostInputSchema,
  blogSettingsSchema,
  builderPageSchema,
  resourceIdSchema,
} from "@websitebuilder/shared";
import { Router } from "express";
import { z } from "zod";

import { ApiProblem, zodProblem } from "../../middleware/errors";
import type { WorkspaceResolver } from "../projects/routes";
import { repairBlogTemplates } from "./repair";
import { BlogRepository, PostConflictError, SlugTakenError } from "./repository";
import type { TemplateRepository } from "./templates";

/** A blog is turned on with a format chosen, never without one. */
const activationSchema = z.object({ format: z.enum(BLOG_FORMATS) }).strict();

/** Which of the two templates a request is about. Anything else is not a template. */
const templateKindSchema = z.enum(["index", "article"]);

/**
 * A template draft, as the editor saves it.
 *
 * The page goes through the same schema a site's own pages do, so a template cannot carry anything
 * a page could not — including, in particular, anything that is not a validated block.
 */
const templateDraftSchema = z
  .object({
    /*
     * A page, minus the one thing a template does not have.
     *
     * `builderPageSchema` requires a route-shaped slug, because a site's pages are addressed by one.
     * A template is not addressed at all — the blog's own routes render through it — so it is seeded
     * with an empty slug, and validating it as an ordinary page asked a layout where it lives.
     * Everything else is identical on purpose: a template must not be able to carry anything a page
     * could not.
     */
    draftDocument: builderPageSchema.extend({ slug: z.union([z.literal(""), builderPageSchema.shape.slug]) }),
    fieldDefinitions: z.array(blogFieldDefinitionSchema).max(40),
    /** The version this edit started from. A save without it cannot detect a stale write. */
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();

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

      const result = await repairBlogTemplates(
        { repository, templates },
        context,
        projectId,
        { format: parsed.data.format },
      );

      res.json({ data: result.settings });
    } catch (error) {
      next(error);
    }
  });

  router.get("/templates/:kind", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:edit");
      const projectId = parseProjectId(param(req, "projectId"));
      const kind = templateKindSchema.safeParse(param(req, "kind"));
      if (!kind.success) throw new ApiProblem("NOT_FOUND", "Template not found");
      if (templates === undefined) throw new ApiProblem("SERVICE_UNAVAILABLE", "Templates are not available");

      res.json({ data: await templates.loadOrCreate(context, projectId, kind.data) });
    } catch (error) {
      next(error);
    }
  });

  router.put("/templates/:kind", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:edit");
      const projectId = parseProjectId(param(req, "projectId"));
      const kind = templateKindSchema.safeParse(param(req, "kind"));
      if (!kind.success) throw new ApiProblem("NOT_FOUND", "Template not found");
      if (templates === undefined) throw new ApiProblem("SERVICE_UNAVAILABLE", "Templates are not available");

      const parsed = templateDraftSchema.safeParse(req.body);
      if (!parsed.success) throw zodProblem(parsed.error);

      const saved = await templates.saveDraft(
        context,
        projectId,
        kind.data,
        parsed.data,
        parsed.data.expectedVersion,
      );

      if (saved === null) {
        // The template exists; it moved on. Telling the two apart matters, because one means
        // "somebody else saved" and the other means "this is not your template".
        const current = await templates.loadOrCreate(context, projectId, kind.data);
        if (parsed.data.expectedVersion !== undefined && current.draftVersion !== parsed.data.expectedVersion) {
          throw new ApiProblem("REVISION_CONFLICT", "This template was saved somewhere else since you opened it");
        }
        throw new ApiProblem("NOT_FOUND", "Template not found");
      }
      res.json({ data: saved });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Promotes the draft to what visitors see.
   *
   * Separate from publishing the site: a template change reaches every article at once, and the
   * impact report names the posts a newly required field would leave incomplete. A blocked report is
   * a 409 with the report in it, not a silent refusal.
   */
  router.post("/templates/:kind/publish", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "publish:execute");
      const projectId = parseProjectId(param(req, "projectId"));
      const kind = templateKindSchema.safeParse(param(req, "kind"));
      if (!kind.success) throw new ApiProblem("NOT_FOUND", "Template not found");
      if (templates === undefined) throw new ApiProblem("SERVICE_UNAVAILABLE", "Templates are not available");

      const published = await repository.list(context, projectId, { status: "published", perPage: 500 });
      const result = await templates.publish(
        context,
        projectId,
        kind.data,
        published.items.map((post) => ({ id: post.id, customFieldValues: post.customFieldValues })),
      );

      if (result === null) throw new ApiProblem("NOT_FOUND", "Template not found");
      if ("impact" in result) {
        res.status(409).json({ data: { published: false, impact: result.impact } });
        return;
      }

      res.json({ data: { published: true, template: result.template } });
    } catch (error) {
      next(error);
    }
  });

  /**
   * The settings, repairing an old blog on the way out.
   *
   * This is where most blogs enabled before template ids existed will be met: somebody opens the
   * blog screen. Repairing here means the site stops being blocked at the moment a person looks at
   * it, rather than staying blocked until they happen to press a button nobody told them about.
   */
  router.get("/settings", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      const projectId = parseProjectId(param(req, "projectId"));

      if (templates === undefined) {
        res.json({ data: await repository.loadSettings(context, projectId) });
        return;
      }

      const result = await repairBlogTemplates({ repository, templates }, context, projectId);
      res.json({ data: result.settings });
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
      // Split off before parsing: the post schema is strict, and this field is about the request
      // rather than about the post.
      const { expectedUpdatedAt, ...body } = (req.body ?? {}) as Record<string, unknown>;
      const parsed = blogPostInputSchema.safeParse(body);
      if (!parsed.success) throw zodProblem(parsed.error);

      /*
       * The version the author was looking at.
       *
       * Sent beside the post rather than inside it because `blogPostInputSchema` is also the create
       * contract, where there is nothing to have changed yet. A request that omits it still writes:
       * the guarantee belongs to the editor, which always reads before it writes.
       */
      const expected = typeof expectedUpdatedAt === "string" ? expectedUpdatedAt : undefined;

      const updated = await repository.update(
        context,
        parseProjectId(param(req, "projectId")),
        param(req, "postId"),
        parsed.data,
        expected,
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
  if (error instanceof SlugTakenError) {
    return new ApiProblem("SLUG_TAKEN", "That address is already used by another post");
  }
  // The same code the builder answers a stale document write with, so one client rule covers both.
  if (error instanceof PostConflictError) {
    return new ApiProblem("REVISION_CONFLICT", "The post changed since it was loaded");
  }
  return error;
}
