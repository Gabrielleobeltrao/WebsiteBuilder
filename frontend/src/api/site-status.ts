import type { AuditCategory, CategoryResult, PublicationState, SiteFeatureState } from "@websitebuilder/shared";

import { apiRequest } from "./client";

export type SiteStatus = {
  projectId: string;
  revision: number;
  features: SiteFeatureState[];
  blocked: boolean;
  blockingIssueCount: number;
  warningCount: number;
  /**
   * What the audits found, bound to the revision they ran against.
   *
   * A category the server could not run is absent, and the panel says "not checked" for it — which
   * is the whole reason the shape is partial. A clean tick that came from nobody looking is worse
   * than no tick at all.
   */
  readiness: Partial<Record<AuditCategory, CategoryResult>>;
  /** The revision the live snapshot was compiled from, or null when nothing is published. */
  activeSourceRevision: number | null;
  /**
   * When that snapshot was published, or null when nothing is live.
   *
   * A post written after this moment is saved, may be published as a post, and is still not on the
   * site — the blog dashboard needs all three states to say anything true about a post.
   */
  activePublishedAt: string | null;
  /**
   * Whether a visitor has the work that is saved.
   *
   * `unknown` belongs to a site whose live version predates source fingerprints: its revision
   * describes the builder document alone, so a post, a layout or a blog setting could have moved
   * since with nothing to compare against. Publishing once replaces the guess with a fact.
   */
  publicationState: PublicationState;
};

export const siteStatusApi = {
  load(workspaceId: string, projectId: string, options: { signal?: AbortSignal } = {}) {
    return apiRequest<SiteStatus>(
      `/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/status`,
      { ...(options.signal ? { signal: options.signal } : {}) },
    );
  },
};
