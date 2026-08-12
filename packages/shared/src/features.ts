import { featureElementTypes } from "./element-registry";
import { walkElements, type BuilderElement } from "./elements";
import type { BuilderPage, SiteFeatureKey, SiteFeatureLifecycle, SiteFeatureState } from "./project";

/**
 * Reconciles which optional modules a site actually uses.
 *
 * The rule that makes this trustworthy: the projection is always derived from saved records, never
 * from a browser toggle. A client boolean cannot hide a module that is genuinely in use, and cannot
 * mark an incomplete one ready. Every result is stamped with the revision it was computed from, so
 * a stale projection is detectable rather than silently believed.
 */

export type FeatureSource = {
  /** Element types placed in the saved document, per feature. */
  draftReferenceCount: number;
  publishedReferenceCount: number;
  /** Deterministic problems that block publication, such as a form with no fields. */
  blockingIssueCount: number;
  warningCount: number;
  /** True when the user explicitly turned the module on, even with no references yet. */
  explicitlyActivated: boolean;
  /** True when records exist but every reference is gone. */
  hasRetainedData: boolean;
};

/**
 * Lifecycle from observed usage.
 *
 * `unused` is the only state that hides the module. Everything else keeps it reachable, because a
 * module the user has touched must not vanish from navigation just because it is incomplete — that
 * is precisely when they need to find it.
 */
export function resolveLifecycle(source: FeatureSource): SiteFeatureLifecycle {
  if (source.blockingIssueCount > 0 && source.draftReferenceCount > 0) return "needs_setup";
  if (source.publishedReferenceCount > 0) return "published";
  if (source.draftReferenceCount > 0) return "draft";
  if (source.explicitlyActivated) return "needs_setup";
  // Records with no live reference are archived, never deleted: hiding a module must never make
  // historical data unreachable.
  if (source.hasRetainedData) return "archived";
  return "unused";
}

/**
 * Whether the module gets an entry in the site navigation.
 *
 * `unused` is the only state that hides it. `archived` used to hide it too, which contradicted the
 * reason archived exists: it is the state of a module whose last page reference is gone and whose
 * *records are not* — blog posts, CMS items, form submissions people actually sent. Hiding the
 * module was hiding the only way to reach them, so deleting one block on one page silently took a
 * customer's inbox with it.
 */
export function isVisibleInNavigation(lifecycle: SiteFeatureLifecycle): boolean {
  return lifecycle !== "unused";
}

/** Whether publication is blocked. An unused module never blocks; an incomplete used one does. */
export function blocksPublication(state: Pick<SiteFeatureState, "lifecycle" | "blockingIssueCount">): boolean {
  return state.lifecycle !== "unused" && state.lifecycle !== "archived" && state.blockingIssueCount > 0;
}

export function reconcileFeature(input: {
  feature: SiteFeatureKey;
  source: FeatureSource;
  sourceRevision: number;
  previous?: SiteFeatureState | undefined;
  now: string;
}): SiteFeatureState {
  const lifecycle = resolveLifecycle(input.source);
  const previous = input.previous;
  const wasUsed = previous !== undefined && previous.lifecycle !== "unused";

  return {
    feature: input.feature,
    lifecycle,
    draftReferenceCount: input.source.draftReferenceCount,
    publishedReferenceCount: input.source.publishedReferenceCount,
    blockingIssueCount: input.source.blockingIssueCount,
    warningCount: input.source.warningCount,
    sourceRevision: input.sourceRevision,
    ...(lifecycle !== "unused"
      ? { firstUsedAt: previous?.firstUsedAt ?? input.now, lastUsedAt: input.now }
      : wasUsed
        ? { ...(previous.firstUsedAt ? { firstUsedAt: previous.firstUsedAt } : {}), ...(previous.lastUsedAt ? { lastUsedAt: previous.lastUsedAt } : {}) }
        : {}),
    ...(previous?.configuredAt ? { configuredAt: previous.configuredAt } : {}),
  };
}

/**
 * Counts live references to a module across the saved pages of a site.
 *
 * The element types are read from the registry rather than listed here. The list this replaced named
 * `form`, `postCollection`, `blogDynamic`, `cmsCollection`, `cmsDynamic` and `search` — none of
 * which is a valid element type, so every comparison was false, every count was zero, and no
 * optional feature could ever leave "unused" no matter what a site contained.
 */
export function countReferences(pages: readonly BuilderPage[], feature: SiteFeatureKey): number {
  const types: readonly string[] = featureElementTypes(feature);
  let count = 0;

  for (const page of pages) {
    for (const section of page.sections) {
      for (const element of walkElements(section.elements)) {
        if (types.includes((element as BuilderElement & { type: string }).type)) count += 1;
      }
    }
  }
  return count;
}

/** A projection computed from an older revision must be recomputed, not trusted. */
export function isStale(state: SiteFeatureState, currentRevision: number): boolean {
  return state.sourceRevision !== currentRevision;
}
