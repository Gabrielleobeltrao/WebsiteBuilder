import { describe, expect, it } from "vitest";

import { elementDefinition } from "./element-registry";
import type { BuilderElement, ElementType } from "./elements";
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
  it("hides only a module nothing has ever touched", () => {
    expect(isVisibleInNavigation("unused")).toBe(false);

    for (const lifecycle of ["draft", "needs_setup", "ready", "published", "error", "archived"] as const) {
      expect(isVisibleInNavigation(lifecycle)).toBe(true);
    }
  });

  it("keeps an archived module reachable, because its records outlived its last page", () => {
    // Removing the last block that showed a form must not take the answers people already sent
    // with it, and the module entry is the only way back to them.
    expect(isVisibleInNavigation(resolveLifecycle(source({ hasRetainedData: true })))).toBe(true);
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

/** A real element of one type, so a count is asserted against something the document accepts. */
function elementOf(type: ElementType, id: string, overrides: Record<string, unknown> = {}): BuilderElement {
  return {
    id,
    name: "",
    geometry: { x: 0, y: 0, width: 100, height: 40, rotation: 0 },
    responsiveLayout: {
      width: { value: 100, unit: "px" },
      height: { value: 40, unit: "px" },
      horizontalConstraint: "left",
      verticalConstraint: "top",
      visible: true,
    },
    zIndex: 1,
    locked: false,
    hidden: false,
    type,
    version: elementDefinition(type).schemaVersion,
    ...elementDefinition(type).defaults(),
    ...overrides,
  } as BuilderElement;
}

describe("countReferences", () => {
  it("counts only element types belonging to the feature", () => {
    const page = createPage({ name: "Home", isHome: true });
    const section = page.sections[0];
    if (!section) throw new Error("fixture is missing its section");

    // Real elements, built from the registry. The fixtures this replaced pushed `{type: "form"}`
    // and `{type: "search"}` — neither is a valid element, so the counts they asserted could only
    // ever have come from comparing strings the document can never contain.
    section.elements.push(elementOf("form", "1"), elementOf("form", "2"), elementOf("text", "3"));

    expect(countReferences([page], "forms")).toBe(2);
    expect(countReferences([page], "search")).toBe(0);
    expect(countReferences([page], "cms")).toBe(0);
  });

  it("finds references nested inside containers", () => {
    const page = createPage({ name: "Home", isHome: true });
    const section = page.sections[0];
    if (!section) throw new Error("fixture is missing its section");

    section.elements.push(
      elementOf("container", "c1", {
        children: [elementOf("container", "c2", { children: [elementOf("form", "f1")] })],
      }),
    );

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
