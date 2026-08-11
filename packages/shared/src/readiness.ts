import type { Finding, Severity } from "./audit";
import type { PerformanceFinding } from "./performance";
import type { ResponsiveFinding } from "./diagnostics";

/**
 * The site readiness report.
 *
 * It aggregates every audit the product runs and, just as importantly, says which ones it did not
 * run. A dashboard that shows "0 problems" because a check never executed is worse than one that
 * shows nothing at all, so `notChecked` is a first-class state rather than an empty list.
 *
 * Nothing here decides whether a site may be published. Publication has its own preflight against
 * one exact revision; this report is advice, and it says so by never using the word.
 */
export const AUDIT_CATEGORIES = ["layout", "accessibility", "links", "content", "performance"] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export type CategoryResult =
  | { status: "not-checked" }
  | { status: "checked"; findings: readonly Finding[]; checkedAt: string; sourceRevision: number };

export type ReadinessSummary = {
  categories: Record<AuditCategory, CategoryResult>;
  errorCount: number;
  warningCount: number;
  manualReviewCount: number;
  notCheckedCategories: AuditCategory[];
  /** True only when every category ran and none produced an error. */
  ready: boolean;
  /** Results computed against an older revision, which the dashboard must not present as current. */
  staleCategories: AuditCategory[];
};

export function summariseReadiness(input: {
  categories: Partial<Record<AuditCategory, CategoryResult>>;
  currentRevision: number;
}): ReadinessSummary {
  const categories = Object.fromEntries(
    AUDIT_CATEGORIES.map((category) => [category, input.categories[category] ?? { status: "not-checked" }]),
  ) as Record<AuditCategory, CategoryResult>;

  const counts: Record<Severity, number> = { error: 0, warning: 0, "manual-review": 0 };
  const notChecked: AuditCategory[] = [];
  const stale: AuditCategory[] = [];

  for (const category of AUDIT_CATEGORIES) {
    const result = categories[category];

    if (result.status === "not-checked") {
      notChecked.push(category);
      continue;
    }

    // A result from an older revision describes a site that no longer exists. It is kept and
    // labelled rather than discarded, because "was clean before your last change" is useful.
    if (result.sourceRevision !== input.currentRevision) stale.push(category);

    for (const finding of result.findings) counts[finding.severity] += 1;
  }

  return {
    categories,
    errorCount: counts.error,
    warningCount: counts.warning,
    manualReviewCount: counts["manual-review"],
    notCheckedCategories: notChecked,
    // Unchecked is not the same as clean. A site is only ready when every category actually ran.
    ready: notChecked.length === 0 && stale.length === 0 && counts.error === 0,
    staleCategories: stale,
  };
}

/** Findings of one severity, across every category that ran, newest category order preserved. */
export function findingsOfSeverity(summary: ReadinessSummary, severity: Severity): Finding[] {
  return AUDIT_CATEGORIES.flatMap((category) => {
    const result = summary.categories[category];
    return result.status === "checked" ? result.findings.filter((finding) => finding.severity === severity) : [];
  });
}

/**
 * Groups findings by the element responsible, so a single broken element is one row rather than
 * five. Findings with no element — a whole-page problem — are grouped under the path.
 */
export function groupByOwner(findings: readonly Finding[]): Array<{ owner: string; findings: Finding[] }> {
  const groups = new Map<string, Finding[]>();

  for (const finding of findings) {
    const owner = finding.elementId ?? finding.path;
    groups.set(owner, [...(groups.get(owner) ?? []), finding]);
  }

  return [...groups.entries()].map(([owner, entries]) => ({ owner, findings: entries }));
}

/** Widens the report's finding type to accept every audit's shape without losing what they add. */
export type AnyFinding = Finding | ResponsiveFinding | PerformanceFinding;
