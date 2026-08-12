import {
  findFormUsages,
  formDefinitionInputSchema,
  formDefinitionUpdateSchema,
  resourceIdSchema,
  type BuilderProject,
  type FormSummary,
  type FormUsage,
} from "@websitebuilder/shared";
import { Router } from "express";
import { z } from "zod";

import { ApiProblem } from "../../middleware/errors";
import type { WorkspaceResolver } from "../projects/routes";
import { streamSubmissionCsv } from "./export";
import {
  FormRevisionConflictError,
  SUBMISSION_STATUSES,
  type FormRepository,
  type SubmissionFilter,
  type SubmissionStatus,
} from "./repository";

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

/** A stale write is a 409 carrying the revision to reload, never a silent overwrite. */
function mapFormError(error: unknown): unknown {
  if (error instanceof FormRevisionConflictError) {
    return new ApiProblem("REVISION_CONFLICT", "This form was modified after it was loaded", [
      { path: "expectedRevision", message: `current revision is ${error.currentRevision}` },
    ]);
  }
  return error;
}

export function createFormsRouter(options: {
  repository: FormRepository;
  resolveWorkspace: WorkspaceResolver;
  /**
   * The saved builder document, so the module can answer where a form is placed.
   *
   * Injected rather than read here: usage is a fact about the document, and the document belongs to
   * the projects module. Absent means no placement information — the routes still work and report
   * no usages, which is what a caller without a document should see.
   */
  loadProject?: (input: {
    workspaceId: string;
    userId: string;
    projectId: string;
  }) => Promise<BuilderProject | null>;
}): Router {
  const { repository, resolveWorkspace, loadProject } = options;
  const router = Router({ mergeParams: true });

  const usagesFor = async (
    context: { workspaceId: string; userId: string },
    projectId: string,
  ): Promise<Map<string, FormUsage[]>> => {
    const project = await loadProject?.({ ...context, projectId });
    if (project == null) return new Map();

    const byForm = new Map<string, FormUsage[]>();
    for (const usage of findFormUsages(project)) {
      const existing = byForm.get(usage.formId);
      if (existing === undefined) byForm.set(usage.formId, [usage]);
      else existing.push(usage);
    }
    return byForm;
  };

  router.get("/", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      const projectId = parseId(param(req, "projectId"), "Project not found");

      const [definitions, counts, usages] = await Promise.all([
        repository.list(context, projectId),
        repository.countsByForm(context, projectId),
        usagesFor(context, projectId),
      ]);

      const data: FormSummary[] = definitions.map((definition) => {
        const count = counts.get(definition.id);
        return {
          ...definition,
          submissionCount: count?.total ?? 0,
          unreadCount: count?.unread ?? 0,
          lastSubmissionAt: count?.lastAt ?? null,
          usages: usages.get(definition.id) ?? [],
        };
      });

      res.json({ data });
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
      res.json({ data: { ...form, usages: (await usagesFor(context, projectId)).get(form.id) ?? [] } });
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

  router.post("/:formId/duplicate", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:edit");
      const projectId = parseId(param(req, "projectId"), "Project not found");

      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      if (name === "") throw new ApiProblem("VALIDATION_ERROR", "The copy needs a name");

      const copy = await repository.duplicate(context, projectId, param(req, "formId"), name.slice(0, 160));
      if (copy === null) throw new ApiProblem("NOT_FOUND", "Form not found");
      res.status(201).json({ data: copy });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:formId/restore", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:edit");
      const projectId = parseId(param(req, "projectId"), "Project not found");

      const restored = await repository.restore(context, projectId, param(req, "formId"));
      if (restored === null) throw new ApiProblem("NOT_FOUND", "Form not found");
      res.json({ data: restored });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:formId", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:edit");
      const projectId = parseId(param(req, "projectId"), "Project not found");
      const formId = param(req, "formId");

      /*
       * A form a page still points at is not deletable at all.
       *
       * The alternative is a block holding an id that resolves to nothing, which publishes as a set
       * of inputs that take an answer and lose it. The response says where the references are, so
       * the caller can offer "show usages" rather than only "no".
       */
      const usages = (await usagesFor(context, projectId)).get(formId) ?? [];
      if (usages.length > 0) {
        throw new ApiProblem(
          "RESOURCE_IN_USE",
          "This form is still shown on a page",
          usages.map((usage) => ({ path: usage.pageId, message: usage.elementId })),
        );
      }

      // Archived rather than deleted where submissions exist: removing the last block that shows a
      // form must never take the answers people already sent with it.
      const outcome = await repository.removeOrArchive(context, projectId, formId);
      if (outcome === "not-found") throw new ApiProblem("NOT_FOUND", "Form not found");

      res.json({ data: { outcome } });
    } catch (error) {
      next(error);
    }
  });

  /*
   * Submissions.
   *
   * Every route below reads the filter from the query string and hands it to the repository, which
   * starts from the verified workspace and this project. A filter can narrow that scope and has no
   * way to widen it — there is no parameter for a workspace, and the form id is matched inside the
   * same query rather than trusted on its own.
   */
  const filterFrom = (query: Record<string, unknown>): SubmissionFilter => {
    const text = (name: string) => (typeof query[name] === "string" && query[name] !== "" ? (query[name] as string) : undefined);
    const status = text("status");
    const number = (name: string) => {
      const parsed = Number(text(name));
      return Number.isFinite(parsed) ? parsed : undefined;
    };

    return {
      ...(text("formId") === undefined ? {} : { formId: text("formId")! }),
      ...(status !== undefined && (SUBMISSION_STATUSES as readonly string[]).includes(status)
        ? { status: status as SubmissionStatus }
        : {}),
      ...(text("from") === undefined ? {} : { from: text("from")! }),
      ...(text("to") === undefined ? {} : { to: text("to")! }),
      ...(text("pageId") === undefined ? {} : { pageId: text("pageId")! }),
      ...(number("page") === undefined ? {} : { page: number("page")! }),
      ...(number("perPage") === undefined ? {} : { perPage: number("perPage")! }),
    };
  };

  router.get("/-/submissions", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      const projectId = parseId(param(req, "projectId"), "Project not found");
      const filter = filterFrom(req.query as Record<string, unknown>);

      const [listed, counts] = await Promise.all([
        repository.listSubmissions(context, projectId, filter),
        repository.submissionCounts(context, projectId, filter),
      ]);

      res.json({ data: { ...listed, counts } });
    } catch (error) {
      next(error);
    }
  });

  router.get("/-/submissions/:submissionId", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      const projectId = parseId(param(req, "projectId"), "Project not found");

      const submission = await repository.findSubmission(context, projectId, param(req, "submissionId"));
      if (submission === null) throw new ApiProblem("NOT_FOUND", "Submission not found");
      res.json({ data: submission });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/-/submissions", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req, "project:edit");
      const projectId = parseId(param(req, "projectId"), "Project not found");

      const parsed = submissionBulkSchema.safeParse(req.body);
      if (!parsed.success) throw new ApiProblem("VALIDATION_ERROR", "That selection is not valid");

      const changed =
        parsed.data.action === "delete"
          ? await repository.deleteSubmissions(context, projectId, parsed.data.ids)
          : await repository.setSubmissionStatuses(context, projectId, parsed.data.ids, parsed.data.action);

      res.json({ data: { changed } });
    } catch (error) {
      next(error);
    }
  });

  /**
   * The export.
   *
   * Per form rather than per project: a single sheet whose columns are the union of every form's
   * questions is a sheet nobody can read. Written a row at a time straight to the response, so the
   * memory this costs does not grow with the customer's success.
   */
  router.get("/:formId/submissions.csv", async (req, res, next) => {
    try {
      const context = await resolveWorkspace(req);
      const projectId = parseId(param(req, "projectId"), "Project not found");
      const formId = param(req, "formId");

      const definition = await repository.findById(context, projectId, formId);
      if (definition === null) throw new ApiProblem("NOT_FOUND", "Form not found");

      const filter = { ...filterFrom(req.query as Record<string, unknown>), formId };
      res
        .status(200)
        .type("text/csv; charset=utf-8")
        .set("content-disposition", `attachment; filename="submissions-${formId}.csv"`)
        // Never rendered by a browser, whatever a stored value looks like.
        .set("x-content-type-options", "nosniff");

      for await (const chunk of streamSubmissionCsv(definition, repository.streamSubmissions(context, projectId, filter))) {
        res.write(chunk);
      }
      res.end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

/**
 * A bulk action over a selection.
 *
 * Delete is an action here rather than a separate route so one confirmation dialog can offer every
 * outcome, and so the id list is validated the same way whichever one is chosen.
 */
const submissionBulkSchema = z
  .object({
    ids: z.array(z.string().min(1).max(64)).min(1).max(500),
    action: z.enum([...SUBMISSION_STATUSES, "delete"]),
  })
  .strict();
