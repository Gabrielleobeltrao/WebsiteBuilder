import { PROJECT_CARD_BLOCKERS, type ProjectCardBlocker, type ProjectCardSummary, type ProjectSummary } from "@websitebuilder/shared";
import { ObjectId, type Db } from "mongodb";

import { COLLECTIONS } from "../../db/indexes";

import { DEFAULT_BLOG_SETTINGS, type BlogSettings } from "@websitebuilder/shared";

import { ANALYTICS_COLLECTIONS, utcDay } from "../analytics/repository";
import { BLOG_COLLECTIONS } from "../blog/repository";
import { sourceFingerprintFrom } from "../publishing/fingerprint";
import { PUBLISHING_COLLECTIONS } from "../publishing/repository";
import { publicationStateFor } from "./routes";
import type { WorkspaceContext } from "./repository";

/**
 * What each site card can say, for a whole page of them at once.
 *
 * The alternative is what a card usually does: ask its own questions when it renders. That is one
 * request per site — the list gets slower with every site a customer adds, the answers land at
 * different times and the page jumps under the reader's hands. Every query here is grouped over the
 * whole page instead, so the cost of the extra detail is a fixed handful of round trips whether the
 * workspace has one site or two hundred.
 *
 * It deliberately loads no builder documents. The full pre-publish audit needs them, and running it
 * for every row would move megabytes to render a list — so the card states the blockers a grouped
 * query can answer and says they are the known ones, and the site's own dashboard runs the rest.
 */

const toObjectId = (id: string): ObjectId | null => (ObjectId.isValid(id) ? new ObjectId(id) : null);

/** How far back the card's traffic number looks. */
export const CARD_TRAFFIC_DAYS = 30;

export async function attachCardSummaries(
  db: Db,
  context: WorkspaceContext,
  projects: readonly ProjectSummary[],
  now: Date = new Date(),
): Promise<ProjectSummary[]> {
  if (projects.length === 0) return [];

  const ids = projects.map((project) => project.id);
  const from = new Date(now.getTime() - CARD_TRAFFIC_DAYS * 24 * 60 * 60 * 1000);
  const scope = { workspaceId: context.workspaceId };

  /*
   * The revision each live snapshot was compiled from.
   *
   * Two steps, because which version is live is a pointer on the project and not a flag on the
   * version: a rollback moves the pointer backwards, so the newest version is not the live one and
   * reading versions alone would report pending changes that do not exist.
   */
  const pointers = await db
    .collection(COLLECTIONS.projects)
    .find(
      { ...scope, _id: { $in: ids.map(toObjectId).filter((id): id is ObjectId => id !== null) } },
      { projection: { activePublishedVersionId: 1 } },
    )
    .toArray();
  const activeVersionIds = pointers
    .map((row) => (row as { activePublishedVersionId?: string }).activePublishedVersionId)
    .filter((id): id is string => id !== undefined);

  const [activeVersions, blogSettings, publishedTemplates, publishablePosts, views, sessions, analyticsOn] =
    await Promise.all([
    activeVersionIds.length === 0
      ? Promise.resolve([])
      : db
          .collection(PUBLISHING_COLLECTIONS.versions)
          .find(
            {
              ...scope,
              _id: { $in: activeVersionIds.map(toObjectId).filter((id): id is ObjectId => id !== null) },
            },
            { projection: { projectId: 1, sourceRevision: 1, sourceFingerprint: 1 } },
          )
          .toArray(),
    db
      .collection(BLOG_COLLECTIONS.settings)
      // Every setting, because every one of them is frozen into a snapshot and changing any is
      // work a visitor has not received.
      .find({ ...scope, projectId: { $in: ids } })
      .toArray(),
    // A blog that is on but whose layouts were never published serves its routes with nothing in
    // them. It is the blocker customers actually hit, and it costs one grouped query to know.
    db
      .collection("blogTemplates")
      .find(
        { ...scope, projectId: { $in: ids }, publishedVersion: { $exists: true } },
        { projection: { projectId: 1, kind: 1, publishedVersion: 1 } },
      )
      .toArray(),
    // The posts a publication would include, as the pair that moves for every mutation: an edit or
    // a publish stamps `updatedAt` and a deletion — the one act that stamps nothing — lowers the
    // count. Grouped, so a page of two hundred cards is still one query.
    db
      .collection(BLOG_COLLECTIONS.posts)
      .aggregate<{ _id: string; count: number; latest: string | null }>([
        { $match: { ...scope, projectId: { $in: ids }, status: "published" } },
        { $group: { _id: "$projectId", count: { $sum: 1 }, latest: { $max: "$updatedAt" } } },
      ])
      .toArray(),
    db
      .collection(ANALYTICS_COLLECTIONS.siteViews)
      .aggregate<{ _id: string; views: number }>([
        { $match: { ...scope, projectId: { $in: ids }, day: { $gte: utcDay(from), $lte: utcDay(now) } } },
        { $group: { _id: "$projectId", views: { $sum: "$views" } } },
      ])
      .toArray(),
    db
      .collection(ANALYTICS_COLLECTIONS.sessions)
      .aggregate<{ _id: string; sessions: number }>([
        { $match: { ...scope, projectId: { $in: ids }, startedAt: { $gte: from, $lt: now } } },
        { $group: { _id: "$projectId", sessions: { $sum: 1 } } },
      ])
      .toArray(),
    db
      .collection(ANALYTICS_COLLECTIONS.settings)
      .find({ ...scope, projectId: { $in: ids }, enabled: true }, { projection: { projectId: 1 } })
      .toArray(),
  ]);

  const activeOf = new Map(
    activeVersions.map((row) => [
      String(row.projectId),
      {
        sourceRevision: Number(row.sourceRevision),
        ...(typeof row.sourceFingerprint === "string" ? { sourceFingerprint: row.sourceFingerprint } : {}),
      },
    ]),
  );
  const settingsOf = new Map(blogSettings.map((row) => [String(row.projectId), row as unknown as BlogSettings]));
  const blogOn = new Set(blogSettings.filter((row) => row.enabled === true).map((row) => String(row.projectId)));
  const publishedTemplateKinds = new Map<string, Set<string>>();
  const templateVersionOf = new Map<string, { index: number | null; article: number | null }>();
  for (const row of publishedTemplates) {
    const key = String(row.projectId);
    const kinds = publishedTemplateKinds.get(key) ?? new Set<string>();
    kinds.add(String(row.kind));
    publishedTemplateKinds.set(key, kinds);

    const versions = templateVersionOf.get(key) ?? { index: null, article: null };
    if (row.kind === "index") versions.index = Number(row.publishedVersion);
    if (row.kind === "article") versions.article = Number(row.publishedVersion);
    templateVersionOf.set(key, versions);
  }
  const postsOf = new Map(publishablePosts.map((row) => [row._id, row]));
  const viewsOf = new Map(views.map((row) => [row._id, row.views]));
  const sessionsOf = new Map(sessions.map((row) => [row._id, row.sessions]));
  const measuringVisitors = new Set(analyticsOn.map((row) => String(row.projectId)));

  return projects.map((project) => {
    const active = activeOf.get(project.id) ?? null;
    const settings = settingsOf.get(project.id);
    const posts = postsOf.get(project.id);
    const versions = templateVersionOf.get(project.id) ?? { index: null, article: null };

    const blockers: ProjectCardBlocker[] = [];
    // Published and reachable from nowhere. Publishing again does not fix it, so a card that only
    // said "published" would send somebody to press the button that cannot help.
    if (project.isPublished && project.liveUrl === undefined) blockers.push("no-address");
    if (blogOn.has(project.id) && (publishedTemplateKinds.get(project.id)?.size ?? 0) < 2) blockers.push("blog-setup");

    const summary: ProjectCardSummary = {
      /*
       * The same rule the site's own status endpoint applies, over the same sources.
       *
       * It used to compare the project's revision alone, so a post written after the last
       * publication left the card saying the site was up to date. Every input here comes from a
       * query grouped over the whole page, so the answer costs no more for two hundred cards than
       * for one.
       */
      publicationState: publicationStateFor({
        projectRevision: project.revision,
        active,
        currentFingerprint: sourceFingerprintFrom({
          projectRevision: project.revision,
          // A site that never touched the blog has no settings row, and the publisher reads the
          // same defaults for it. Substituting them here is what keeps the comparison meaningful
          // for the majority of sites rather than falling back to the revision.
          settings: settings ?? DEFAULT_BLOG_SETTINGS,
          publishablePostCount: posts?.count ?? 0,
          latestPostChangeAt: posts?.latest ?? null,
          indexTemplateVersion: versions.index,
          articleTemplateVersion: versions.article,
        }),
      }),
      knownBlockers: blockers.filter((code) => PROJECT_CARD_BLOCKERS.includes(code)),
      traffic: project.isPublished
        ? {
            state: "measured",
            days: CARD_TRAFFIC_DAYS,
            // Server counting starts at the first publication and needs no consent, so this number
            // exists for every live site.
            views: viewsOf.get(project.id) ?? 0,
            // Visitors come from the browser, which only runs where the owner turned it on. Null
            // until then, because a site nobody is measuring has not had zero visitors.
            visitors: measuringVisitors.has(project.id) ? (sessionsOf.get(project.id) ?? 0) : null,
          }
        : { state: "unavailable" },
    };

    return { ...project, summary };
  });
}
