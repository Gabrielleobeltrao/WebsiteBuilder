import type { BlogFormat, BlogSettings } from "@websitebuilder/shared";

import type { WorkspaceContext } from "../projects/repository";
import type { BlogRepository } from "./repository";
import type { TemplateRepository } from "./templates";

/**
 * Makes a blog that is on into a blog that can serve its own routes.
 *
 * A blog enabled before template ids existed has `enabled: true` and neither id, so `blogSetupIssues`
 * reports two blocking problems for the rest of the project's life — and those block publication of
 * the *whole site*, not just the blog. Templates could already be created lazily on read, but the
 * settings were never told, so the same two issues came back on the next check and the customer had
 * a site that could not be published and a screen that named no action.
 *
 * One operation, used by activation and by the reads that meet an old blog, so there is a single
 * answer to "what does a blog need to exist".
 *
 * Idempotent by construction: an id that is already set is never replaced, a template that already
 * exists is loaded rather than recreated, and a settings write happens only when something is
 * actually missing. Running it twice is one write and then none.
 */

export type BlogRepairResult = {
  /** What was missing before this ran. Empty means there was nothing to do. */
  missing: Array<"index" | "article">;
  /** False for a dry run, and for a blog that needed nothing. */
  repaired: boolean;
  settings: BlogSettings;
};

export async function repairBlogTemplates(
  deps: { repository: BlogRepository; templates: TemplateRepository },
  context: WorkspaceContext,
  projectId: string,
  options: { dryRun?: boolean; format?: BlogFormat } = {},
): Promise<BlogRepairResult> {
  const settings = await deps.repository.loadSettings(context, projectId);

  // A blog nobody turned on needs nothing. Creating templates for it would invent state the customer
  // never asked for and make an unused module look started.
  const enabling = options.format !== undefined;
  if (!settings.enabled && !enabling) return { missing: [], repaired: false, settings };

  const missing: Array<"index" | "article"> = [];
  if (settings.indexTemplateId === undefined) missing.push("index");
  if (settings.articleTemplateId === undefined) missing.push("article");

  if (missing.length === 0 && !enabling) return { missing, repaired: false, settings };
  if (options.dryRun === true) return { missing, repaired: false, settings };

  /*
   * Both ids are written together.
   *
   * A blog with one template and not the other is still blocked, so persisting them one at a time
   * would leave a window where a repair had happened and the site was still refused — and a caller
   * that failed halfway would leave that state permanently.
   */
  const [index, article] = await Promise.all([
    deps.templates.loadOrCreate(context, projectId, "index"),
    deps.templates.loadOrCreate(context, projectId, "article"),
  ]);

  /*
   * The starters are published as well as created.
   *
   * A template that exists only as a draft renders nothing publicly, so a repaired blog would stop
   * being blocked and still serve an empty page. Publishing a starter nobody has edited carries no
   * risk: there is no earlier version of it to overwrite.
   */
  await Promise.all([
    deps.templates.publish(context, projectId, "index", []),
    deps.templates.publish(context, projectId, "article", []),
  ]);

  const saved = await deps.repository.saveSettings(context, projectId, {
    ...settings,
    enabled: true,
    ...(options.format === undefined ? {} : { format: options.format }),
    // Never replaced: an id already there points at a template somebody may have designed.
    indexTemplateId: settings.indexTemplateId ?? index.id,
    articleTemplateId: settings.articleTemplateId ?? article.id,
  });

  return { missing, repaired: true, settings: saved };
}

/** One project the audit found, and what it is missing. */
export type BlogRepairCandidate = {
  workspaceId: string;
  projectId: string;
  missing: Array<"index" | "article">;
};

/**
 * Every enabled blog that cannot serve its own routes, without changing any of them.
 *
 * A dry run first, because the alternative is discovering the size of the problem by fixing it. It
 * reads the settings collection directly rather than one project at a time: the question is "how
 * many sites are in this state", and asking it per project would need the list of projects the
 * problem is being measured across.
 *
 * Scoped to a workspace when one is given. Without one it is an operator-wide count, which is the
 * only form in which the number is useful and the reason this is not exposed as a tenant endpoint.
 */
export async function auditBlogTemplates(
  deps: { repository: BlogRepository },
  options: { workspaceId?: string } = {},
): Promise<BlogRepairCandidate[]> {
  const rows = await deps.repository.listSettingsForAudit(options);

  return rows
    .map((row) => ({
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      missing: [
        ...(row.indexTemplateId === undefined ? (["index"] as const) : []),
        ...(row.articleTemplateId === undefined ? (["article"] as const) : []),
      ],
    }))
    .filter((candidate) => candidate.missing.length > 0);
}
