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
 *
 * And it repairs only what is broken. A reference that is missing gets a starter, and only a starter
 * this call created is published — a template that was already there keeps whatever its author has
 * done to it, published or not.
 */

export type BlogRepairResult = {
  /** What was missing before this ran. Empty means there was nothing to do. */
  missing: Array<"index" | "article">;
  /** The kinds this call created and published. Never one that already existed. */
  published: Array<"index" | "article">;
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
  if (!settings.enabled && !enabling) return { missing: [], published: [], repaired: false, settings };

  const missing: Array<"index" | "article"> = [];
  if (settings.indexTemplateId === undefined) missing.push("index");
  if (settings.articleTemplateId === undefined) missing.push("article");

  if (missing.length === 0 && !enabling) return { missing, published: [], repaired: false, settings };
  if (options.dryRun === true) return { missing, published: [], repaired: false, settings };

  /*
   * Only the kinds whose reference is actually missing.
   *
   * This used to load-or-create both and then publish both, whatever was wrong. A customer with a
   * designed article layout and only the index reference missing had their unfinished article draft
   * promoted onto every post of their live site, by the act of opening the blog screen.
   */
  const kinds = enabling ? (["index", "article"] as const) : missing;
  const created = await Promise.all(
    kinds.map(async (kind) => ({
      kind,
      ...(await deps.templates.createStarterIfMissing(context, projectId, kind)),
    })),
  );

  /*
   * A starter this repair made is published; nothing else ever is.
   *
   * A template that exists only as a draft renders the built-in layout, so publishing the starter is
   * what makes a repaired blog serve something of its own. There is no earlier version of a starter
   * to overwrite and nobody has edited it, which is exactly what makes that safe — and exactly what
   * is not true of a template that was already there.
   */
  await Promise.all(
    created
      .filter((result) => result.created)
      .map((result) => deps.templates.publish(context, projectId, result.kind, [])),
  );

  const templateIdFor = (kind: "index" | "article") => created.find((result) => result.kind === kind)?.template.id;

  const saved = await deps.repository.saveSettings(context, projectId, {
    ...settings,
    enabled: true,
    ...(options.format === undefined ? {} : { format: options.format }),
    // Never replaced: an id already there points at a template somebody may have designed.
    ...(settings.indexTemplateId === undefined && templateIdFor("index") !== undefined
      ? { indexTemplateId: templateIdFor("index") }
      : {}),
    ...(settings.articleTemplateId === undefined && templateIdFor("article") !== undefined
      ? { articleTemplateId: templateIdFor("article") }
      : {}),
  });

  return {
    missing,
    published: created.filter((result) => result.created).map((result) => result.kind),
    repaired: true,
    settings: saved,
  };
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
