import {
  countReferences,
  reconcileFeature,
  SITE_FEATURE_KEYS,
  type BuilderProject,
  type SiteFeatureKey,
  type SiteFeatureState,
} from "@websitebuilder/shared";

/**
 * Reconciles a project's feature projection from source records.
 *
 * This runs on the server and reads real data — the saved builder document plus each module's own
 * collections. A client never supplies any part of the answer, which is the whole point: the
 * projection exists so navigation and publication readiness agree with what is actually stored.
 */
export type ModuleFacts = {
  /** Module has records of its own, e.g. a blog with settings or posts. */
  hasRecords: boolean;
  /** The user turned it on explicitly, even with nothing placed on a page yet. */
  explicitlyActivated: boolean;
  /** Deterministic problems that must be fixed before publishing. */
  blockingIssueCount: number;
  warningCount: number;
};

export type SiteStatus = {
  projectId: string;
  revision: number;
  features: SiteFeatureState[];
  /** True when at least one in-use module has a blocking problem. */
  blocked: boolean;
  blockingIssueCount: number;
  warningCount: number;
};

const NO_FACTS: ModuleFacts = {
  hasRecords: false,
  explicitlyActivated: false,
  blockingIssueCount: 0,
  warningCount: 0,
};

export function reconcileSiteStatus(input: {
  project: BuilderProject;
  facts: Partial<Record<SiteFeatureKey, ModuleFacts>>;
  now?: string;
}): SiteStatus {
  const now = input.now ?? new Date().toISOString();
  const previousByFeature = new Map(input.project.featureStates.map((state) => [state.feature, state]));

  const features = SITE_FEATURE_KEYS.map((feature) => {
    const facts = input.facts[feature] ?? NO_FACTS;
    const draftReferenceCount = countReferences(input.project.pages, feature);

    return reconcileFeature({
      feature,
      sourceRevision: input.project.revision,
      previous: previousByFeature.get(feature),
      now,
      source: {
        draftReferenceCount,
        // Published references are counted from the active snapshot in Phase 18; until a site has
        // been published there are none, and claiming otherwise would let an unpublished module
        // report itself as live.
        publishedReferenceCount: 0,
        blockingIssueCount: facts.blockingIssueCount,
        warningCount: facts.warningCount,
        explicitlyActivated: facts.explicitlyActivated,
        hasRetainedData: facts.hasRecords && draftReferenceCount === 0,
      },
    });
  });

  const inUse = features.filter((state) => state.lifecycle !== "unused" && state.lifecycle !== "archived");

  return {
    projectId: input.project.id,
    revision: input.project.revision,
    features,
    blocked: inUse.some((state) => state.blockingIssueCount > 0),
    blockingIssueCount: inUse.reduce((total, state) => total + state.blockingIssueCount, 0),
    warningCount: inUse.reduce((total, state) => total + state.warningCount, 0),
  };
}
