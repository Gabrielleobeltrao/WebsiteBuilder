import { publicationSourceFingerprint, type BlogSettings } from "@websitebuilder/shared";

/**
 * The one place that turns a site's sources into the value publication stores.
 *
 * Three callers ask the same question from three different reads — the publisher, the site status
 * endpoint and the batched card summaries — and the answer is only useful if all three agree. A
 * second mapping written beside any of them would drift, and the symptom would be a dashboard that
 * disagrees with a card about whether a site has unpublished work.
 */
export function sourceFingerprintFrom(input: {
  projectRevision: number;
  settings: BlogSettings;
  /** Posts a publication would include: published ones only. */
  publishablePostCount: number;
  /** The newest `updatedAt` among them, or null when there are none. */
  latestPostChangeAt: string | null;
  indexTemplateVersion: number | null;
  articleTemplateVersion: number | null;
}): string {
  return publicationSourceFingerprint({
    projectRevision: input.projectRevision,
    blog: {
      settings: input.settings,
      publishablePostCount: input.publishablePostCount,
      latestPostChangeAt: input.latestPostChangeAt,
      indexTemplateVersion: input.indexTemplateVersion,
      articleTemplateVersion: input.articleTemplateVersion,
    },
  });
}
