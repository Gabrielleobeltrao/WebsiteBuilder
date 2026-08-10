import { describe, expect, it } from "vitest";

import {
  blocksPublication,
  countReferences,
  isStale,
  isVisibleInNavigation,
  reconcileFeature,
  resolveLifecycle,
  type FeatureSource,
} from "./features";
import { createPage } from "./project";
import type { SiteFeatureState } from "./project";

const source = (overrides: Partial<FeatureSource> = {}): FeatureSource => ({
  draftReferenceCount: 0,
  publishedReferenceCount: 0,
  blockingIssueCount: 0,
  warningCount: 0,
  explicitlyActivated: false,
  hasRetainedData: false,
  ...overrides,
});

const NOW = "2026-08-10T12:00:00.000Z";

describe("resolveLifecycle", () => {
  it("is unused when nothing references it and it was never activated", () => {
    expect(resolveLifecycle(source())).toBe("unused");
  });

  it("is draft once something references it", () => {
    expect(resolveLifecycle(source({ draftReferenceCount: 1 }))).toBe("draft");
  });

  it("is published once a published reference exists", () => {
    expect(resolveLifecycle(source({ draftReferenceCount: 1, publishedReferenceCount: 1 }))).toBe("published");
  });

  it("is needs_setup when a live reference has a blocking problem", () => {
    expect(resolveLifecycle(source({ draftReferenceCount: 1, blockingIssueCount: 2 }))).toBe("needs_setup");
  });

  it("is needs_setup when explicitly activated with nothing placed yet", () => {
    expect(resolveLifecycle(source({ explicitlyActivated: true }))).toBe("needs_setup");
  });

  it("is archived when records survive but no reference does", () => {
    expect(resolveLifecycle(source({ hasRetainedData: true }))).toBe("archived");
  });

  it("does not let a blocking issue on zero references pretend the module is in use", () => {
    expect(resolveLifecycle(source({ blockingIssueCount: 3 }))).toBe("unused");
  });
});

describe("navigation visibility", () => {
  it("hides only unused and archived modules", () => {
    expect(isVisibleInNavigation("unused")).toBe(false);
    expect(isVisibleInNavigation("archived")).toBe(false);

    for (const lifecycle of ["draft", "needs_setup", "ready", "published", "error"] as const) {
      expect(isVisibleInNavigation(lifecycle)).toBe(true);
    }
  });

  it("keeps an incomplete module visible, which is exactly when the user needs to find it", () => {
    expect(isVisibleInNavigation(resolveLifecycle(source({ draftReferenceCount: 1, blockingIssueCount: 1 })))).toBe(
      true,
    );
  });
});

describe("blocksPublication", () => {
  it("blocks an in-use module with a blocking issue", () => {
    expect(blocksPublication({ lifecycle: "needs_setup", blockingIssueCount: 1 })).toBe(true);
  });

  it("never blocks on an unused or archived module", () => {
    expect(blocksPublication({ lifecycle: "unused", blockingIssueCount: 5 })).toBe(false);
    expect(blocksPublication({ lifecycle: "archived", blockingIssueCount: 5 })).toBe(false);
  });

  it("does not block a used module with only warnings", () => {
    expect(blocksPublication({ lifecycle: "draft", blockingIssueCount: 0 })).toBe(false);
  });
});

describe("reconcileFeature", () => {
  it("stamps the revision it was computed from", () => {
    const state = reconcileFeature({ feature: "forms", source: source({ draftReferenceCount: 1 }), sourceRevision: 7, now: NOW });
    expect(state.sourceRevision).toBe(7);
    expect(state.lifecycle).toBe("draft");
  });

  it("records first use once and keeps it through later reconciliations", () => {
    const first = reconcileFeature({
      feature: "forms",
      source: source({ draftReferenceCount: 1 }),
      sourceRevision: 1,
      now: "2026-08-01T00:00:00.000Z",
    });
    const later = reconcileFeature({
      feature: "forms",
      source: source({ draftReferenceCount: 2 }),
      sourceRevision: 2,
      previous: first,
      now: NOW,
    });

    expect(later.firstUsedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(later.lastUsedAt).toBe(NOW);
  });

  it("keeps the usage history when a module falls back to unused", () => {
    const used = reconcileFeature({
      feature: "blog",
      source: source({ draftReferenceCount: 1 }),
      sourceRevision: 1,
      now: "2026-08-01T00:00:00.000Z",
    });
    const removed = reconcileFeature({
      feature: "blog",
      source: source(),
      sourceRevision: 2,
      previous: used,
      now: NOW,
    });

    expect(removed.lifecycle).toBe("unused");
    expect(removed.firstUsedAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("cannot be told a lifecycle by its caller — it is derived from the source only", () => {
    const state = reconcileFeature({
      feature: "cms",
      source: source(),
      sourceRevision: 3,
      previous: { feature: "cms", lifecycle: "published", draftReferenceCount: 9, publishedReferenceCount: 9, blockingIssueCount: 0, warningCount: 0, sourceRevision: 1 } as SiteFeatureState,
      now: NOW,
    });
    expect(state.lifecycle).toBe("unused");
    expect(state.draftReferenceCount).toBe(0);
  });
});

describe("countReferences", () => {
  it("counts only element types belonging to the feature", () => {
    const page = createPage({ name: "Home", isHome: true });
    const section = page.sections[0];
    if (!section) throw new Error("fixture is missing its section");

    section.elements.push(
      { type: "form", id: "1" } as never,
      { type: "form", id: "2" } as never,
      { type: "search", id: "3" } as never,
    );

    expect(countReferences([page], "forms")).toBe(2);
    expect(countReferences([page], "search")).toBe(1);
    expect(countReferences([page], "cms")).toBe(0);
  });

  it("finds references nested inside containers", () => {
    const page = createPage({ name: "Home", isHome: true });
    const section = page.sections[0];
    if (!section) throw new Error("fixture is missing its section");

    section.elements.push({
      type: "container",
      id: "c1",
      children: [{ type: "container", id: "c2", children: [{ type: "form", id: "f1" }] }],
    } as never);

    expect(countReferences([page], "forms")).toBe(1);
  });

  it("returns zero for a site with no pages", () => {
    expect(countReferences([], "forms")).toBe(0);
  });
});

describe("isStale", () => {
  it("detects a projection computed from an older revision", () => {
    const state = reconcileFeature({ feature: "forms", source: source(), sourceRevision: 4, now: NOW });
    expect(isStale(state, 4)).toBe(false);
    expect(isStale(state, 5)).toBe(true);
  });
});
