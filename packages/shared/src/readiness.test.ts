import { describe, expect, it } from "vitest";

import type { Finding } from "./audit";
import {
  AUDIT_CATEGORIES,
  findingsOfSeverity,
  groupByOwner,
  summariseReadiness,
  type CategoryResult,
} from "./readiness";

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  code: "overflow",
  severity: "error",
  path: "/",
  detail: "Something is wrong.",
  ...overrides,
});

const checked = (findings: Finding[], sourceRevision = 5): CategoryResult => ({
  status: "checked",
  findings,
  checkedAt: "2026-08-10T10:00:00.000Z",
  sourceRevision,
});

const allChecked = (findings: Finding[] = []) =>
  Object.fromEntries(AUDIT_CATEGORIES.map((category) => [category, checked(findings)]));

describe("not checked is not clean", () => {
  it("reports a category that never ran rather than counting it as passing", () => {
    const summary = summariseReadiness({ categories: {}, currentRevision: 5 });

    expect(summary.notCheckedCategories).toEqual([...AUDIT_CATEGORIES]);
    expect(summary.errorCount).toBe(0);
    // Zero problems and zero checks are not the same claim.
    expect(summary.ready).toBe(false);
  });

  it("is ready only when every category ran clean at the current revision", () => {
    expect(summariseReadiness({ categories: allChecked(), currentRevision: 5 }).ready).toBe(true);
  });

  it("is not ready while one category is still unchecked", () => {
    const categories = { ...allChecked() };
    delete (categories as Record<string, unknown>).performance;

    const summary = summariseReadiness({ categories, currentRevision: 5 });
    expect(summary.notCheckedCategories).toEqual(["performance"]);
    expect(summary.ready).toBe(false);
  });
});

describe("stale results", () => {
  it("labels a result computed against an older revision", () => {
    const summary = summariseReadiness({
      categories: { layout: checked([], 4), accessibility: checked([], 5) },
      currentRevision: 5,
    });

    expect(summary.staleCategories).toEqual(["layout"]);
  });

  it("keeps a stale result rather than discarding it", () => {
    // "Was clean before your last change" is useful; silently dropping it is not.
    const summary = summariseReadiness({ categories: { layout: checked([finding()], 4) }, currentRevision: 5 });

    expect(summary.categories.layout.status).toBe("checked");
    expect(summary.errorCount).toBe(1);
  });

  it("is not ready while any result is stale, even with no errors", () => {
    expect(summariseReadiness({ categories: allChecked([]), currentRevision: 6 }).ready).toBe(false);
  });
});

describe("counts", () => {
  it("separates errors, warnings and things needing a person", () => {
    const summary = summariseReadiness({
      categories: {
        layout: checked([finding(), finding({ severity: "warning" })]),
        accessibility: checked([finding({ severity: "manual-review" })]),
      },
      currentRevision: 5,
    });

    expect(summary.errorCount).toBe(1);
    expect(summary.warningCount).toBe(1);
    expect(summary.manualReviewCount).toBe(1);
  });

  it("filters by severity across every category", () => {
    const summary = summariseReadiness({
      categories: { layout: checked([finding()]), links: checked([finding({ severity: "warning" })]) },
      currentRevision: 5,
    });

    expect(findingsOfSeverity(summary, "error")).toHaveLength(1);
    expect(findingsOfSeverity(summary, "warning")).toHaveLength(1);
  });
});

describe("ownership", () => {
  it("groups several findings about one element into one row", () => {
    const groups = groupByOwner([
      finding({ elementId: "hero" }),
      finding({ elementId: "hero", code: "small-text" }),
      finding({ elementId: "footer" }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.owner === "hero")?.findings).toHaveLength(2);
  });

  it("groups a whole-page problem under its path", () => {
    const groups = groupByOwner([finding({ path: "/about" })]);
    expect(groups[0]?.owner).toBe("/about");
  });
});

describe("what it does not claim", () => {
  it("never says a site is published or safe to publish", () => {
    // Publication has its own preflight against one exact revision; this report is advice.
    const summary = summariseReadiness({ categories: allChecked(), currentRevision: 5 });
    expect(Object.keys(summary)).not.toContain("published");
    expect(Object.keys(summary)).not.toContain("canPublish");
  });
});
