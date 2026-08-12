import { walkElements } from "./elements";
import type { FormRecord } from "./forms";
import { pagePath, type BuilderProject } from "./project";
import { resolvePageSections } from "./shared-sections";

/**
 * Where a form is placed.
 *
 * "Show usages" has to answer a question with a destination in it: which page, which block, so that
 * clicking it opens the builder on the thing being talked about. A count alone tells somebody a
 * form is in use and leaves them to find it.
 *
 * Deletion depends on this too. A definition a page still points at cannot be removed, because the
 * page would publish as a set of inputs that accept an answer and lose it.
 */
export type FormUsage = {
  formId: string;
  pageId: string;
  pageName: string;
  path: string;
  sectionId: string;
  elementId: string;
  /** True when the block lives in a shared header or footer, and therefore on every page using it. */
  shared: boolean;
};

/**
 * A definition plus what the Forms overview needs beside it, so the list is one request.
 *
 * Lives here rather than in `forms.ts` because usage is derived from the document, and `forms.ts`
 * deliberately knows nothing about pages.
 */
export type FormSummary = FormRecord & {
  submissionCount: number;
  unreadCount: number;
  lastSubmissionAt: string | null;
  usages: FormUsage[];
};

/** One definition, with the placements the caller asked about. */
export type FormDetail = FormRecord & { usages: FormUsage[] };

/**
 * Every form placement in a document, one entry per block.
 *
 * Sections are resolved first, so a form inside a shared header is found at all — a page stores a
 * reference to that section rather than a copy, and walking the stored sections would report the
 * form as unused while it renders on every page of the site.
 *
 * A shared block is reported once, against the first page that includes it: it is one block, and
 * listing it per page would turn one placement into as many rows as the site has pages.
 */
export function findFormUsages(project: Pick<BuilderProject, "pages" | "sharedSections">): FormUsage[] {
  const usages: FormUsage[] = [];
  const seen = new Set<string>();

  for (const page of project.pages) {
    for (const section of resolvePageSections(project, page)) {
      for (const element of walkElements(section.elements)) {
        if (element.type !== "form" || element.formId === "") continue;
        if (seen.has(element.id)) continue;
        seen.add(element.id);

        usages.push({
          formId: element.formId,
          pageId: page.id,
          pageName: page.name,
          path: pagePath(page),
          sectionId: section.id,
          elementId: element.id,
          shared: section.sharedSectionId !== undefined,
        });
      }
    }
  }

  return usages;
}

/**
 * Blocks that were inserted and never bound to anything.
 *
 * They are not usages — there is no form to be a usage of — and they are the single most common
 * reason a page is not ready to publish, so they are counted rather than silently ignored.
 */
export function countUnboundFormBlocks(project: Pick<BuilderProject, "pages" | "sharedSections">): number {
  const seen = new Set<string>();

  for (const page of project.pages) {
    for (const section of resolvePageSections(project, page)) {
      for (const element of walkElements(section.elements)) {
        if (element.type === "form" && element.formId === "") seen.add(element.id);
      }
    }
  }

  return seen.size;
}

/** Usages grouped by the form they point at, for a screen that lists forms rather than placements. */
export function groupUsagesByForm(usages: readonly FormUsage[]): Map<string, FormUsage[]> {
  const byForm = new Map<string, FormUsage[]>();
  for (const usage of usages) {
    const existing = byForm.get(usage.formId);
    if (existing === undefined) byForm.set(usage.formId, [usage]);
    else existing.push(usage);
  }
  return byForm;
}
