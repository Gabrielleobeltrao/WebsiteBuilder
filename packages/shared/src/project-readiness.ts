import { auditPageAccessibility, auditPageLinks, type Finding } from "./audit";
import { auditPageBlocks } from "./block-readiness";
import { diagnoseResponsive } from "./diagnostics";
import type { BuilderProject } from "./project";
import { renderablePage } from "./shared-sections";
import type { AuditCategory, CategoryResult } from "./readiness";

/**
 * Runs the audits the product actually has, against one exact revision.
 *
 * The dashboard used to be handed an empty object, so every category read "not checked" and the
 * panel could say nothing else. The fix is not to invent results: it is to run the four audits that
 * exist and to keep saying "not checked" for the one that cannot run here, because a category
 * reported as clean because nothing looked at it is the single worst thing this panel could do.
 *
 * Every result carries the revision it was computed from, so a report from before the last edit is
 * labelled stale rather than shown as current.
 */

const pathOf = (page: BuilderProject["pages"][number]) => (page.isHome ? "/" : `/${page.slug}`);

export function auditProjectReadiness(input: {
  project: BuilderProject;
  /** Whether the workspace owns a media id. Links and content both need it to be truthful. */
  mediaExists: (mediaId: string) => boolean;
  now?: string;
}): Partial<Record<AuditCategory, CategoryResult>> {
  const now = input.now ?? new Date().toISOString();
  const sourceRevision = input.project.revision;
  const pages = input.project.pages.map((page) => ({ page: renderablePage(input.project, page), path: pathOf(page) }));

  const resolvePagePath = (pageId: string): string | null => {
    const found = input.project.pages.find((page) => page.id === pageId);
    return found === undefined ? null : pathOf(found);
  };

  const checked = (findings: Finding[]): CategoryResult => ({
    status: "checked",
    findings,
    checkedAt: now,
    sourceRevision,
  });

  // A responsive finding already carries the audit severity vocabulary; only the sweep's extra
  // width ranges are dropped, because the panel reports a problem rather than a measurement.
  const layout = pages.flatMap(({ page, path }) =>
    diagnoseResponsive({ page, path, breakpoints: input.project.breakpoints }).map(
      ({ code, severity, path: at, elementId, detail }): Finding => ({ code, severity, path: at, elementId, detail }),
    ),
  );

  const accessibility = pages.flatMap(({ page, path }) => auditPageAccessibility(page, path));
  const links = pages.flatMap(({ page, path }) =>
    auditPageLinks(page, path, { resolvePagePath, mediaExists: input.mediaExists }),
  );
  // A block finding is already a `Finding`, with the element and page it belongs to attached.
  const content = pages.flatMap(({ page, path }) => auditPageBlocks({ page, path, document: input.project }));

  return {
    layout: checked(layout),
    accessibility: checked(accessibility),
    links: checked(links),
    content: checked(content),
    // Performance is measured against built route assets, which exist after a build and not in a
    // request. Saying so is the honest answer; reporting it clean would be a lie with a tick beside it.
  };
}
