/**
 * Publishes one site into the E2E database, so browser tests have a real published page to visit.
 *
 * It goes through the same repositories and the same publishing service the application uses, not
 * through hand-written documents: a fixture built by a different path would let a change break the
 * product while the suite stayed green.
 *
 * Run from the backend workspace with the launcher's environment. It is idempotent only in the
 * sense that the database is thrown away between runs.
 */
import { createEmptySection, createPage } from "@websitebuilder/shared";

import { connectDatabase } from "../../../backend/src/db/client";
import { loadEnv } from "../../../backend/src/config/env";
import { createLogger } from "../../../backend/src/config/logger";
import { COLLECTIONS, ensureIndexes } from "../../../backend/src/db/indexes";
import { ensureAnalyticsIndexes } from "../../../backend/src/modules/analytics/repository";
import { BlogRepository } from "../../../backend/src/modules/blog/repository";
import { MediaRepository } from "../../../backend/src/modules/media/repository";
import { createGridFsStorage } from "../../../backend/src/modules/media/storage";
import { ProjectRepository } from "../../../backend/src/modules/projects/repository";
import { ensurePublishingIndexes, PublishingRepository } from "../../../backend/src/modules/publishing/repository";
import { PublishingService } from "../../../backend/src/modules/publishing/service";

/** The hostname browser tests visit. Kept in one place because the tests and the seed must agree. */
export const E2E_SITE_SLUG = "e2e-site";
export const E2E_WORKSPACE_ID = "e2e-workspace";

const context = { workspaceId: E2E_WORKSPACE_ID, userId: "e2e-user" };

async function main(): Promise<void> {
  const env = loadEnv(process.env, "renderer");
  const logger = createLogger(env).child({ service: "e2e-seed" });
  const { db, close } = await connectDatabase(env, logger);

  await ensureIndexes(db);
  await ensurePublishingIndexes(db);
  await ensureAnalyticsIndexes(db);

  const projects = new ProjectRepository(db);
  const publishing = new PublishingRepository(db, db.collection(COLLECTIONS.projects));
  const service = new PublishingService({
    projects,
    publishing,
    blog: new BlogRepository(db),
    media: new MediaRepository(db, createGridFsStorage(db)),
  });

  const project = await projects.create(context, { name: "E2E Site" });
  const { id, workspaceId, createdByUserId, revision, createdAt, updatedAt, ...document } = project;

  const home = document.pages[0]!;
  home.seo.title = "E2E home";
  home.seo.description = "A published page that exists so browser tests have somewhere to go.";
  // Taller than any test viewport, so scroll-depth behaviour is observable rather than trivially
  // complete on load.
  home.canvas = { ...home.canvas, minHeight: 4000 };
  home.sections = [
    section("hero", 800, [heading("Published by the E2E fixture"), button("cta-primary", "Read more", "/about")]),
    section("middle", 1600, [heading("Halfway down")]),
    section("foot", 1600, [heading("The bottom")]),
  ];

  const about = createPage({ name: "About", slug: "about", order: 1 });
  about.seo = { ...about.seo, title: "E2E about", description: "The fixture's second route." };
  about.sections = [section("about-hero", 900, [heading("About the fixture")])];
  document.pages.push(about);

  const saved = await projects.saveDocument(context, project.id, revision, document as never);
  if (saved === null) throw new Error("the seed document was rejected");

  const published = await service.publish(context, project.id);
  if (published.status !== "published") {
    throw new Error(`seeding could not publish: ${published.status} ${JSON.stringify(published)}`);
  }

  const domain = await publishing.ensurePlatformDomain(context, project.id, E2E_SITE_SLUG, env.PLATFORM_ROOT_DOMAIN);
  if (domain === null) throw new Error("the seed site got no platform hostname");

  logger.info({ hostname: domain.hostname, projectId: project.id }, "seeded a published site");
  await close();
}

/**
 * Built from the shared constructor rather than by hand: a fixture assembled through a different
 * path can keep passing while the shape the product accepts moves underneath it.
 */
function section(id: string, height: number, elements: unknown[]) {
  return {
    ...createEmptySection(),
    id,
    name: id,
    heightByBreakpoint: { desktop: { value: height, unit: "px" as const } },
    elements,
  } as never;
}

function heading(text: string) {
  return {
    ...base(`heading-${text.slice(0, 8)}`, 40, 40, 900, 60),
    type: "text",
    tag: "h2",
    content: text,
    style: {
      fontFamily: "Inter",
      fontSize: { value: 32, unit: "px" },
      fontWeight: 700,
      fontStyle: "normal",
      textAlign: "left",
      color: "#0d1424",
      lineHeight: 1.3,
    },
  };
}

function button(id: string, text: string, path: string) {
  return {
    ...base(id, 40, 140, 220, 52),
    type: "button",
    text,
    link: { kind: "external", url: `https://example.test${path}` },
    style: {
      fontSize: { value: 16, unit: "px" },
      fontWeight: 600,
      textColor: "#ffffff",
      backgroundColor: "#2f6df6",
      borderRadius: 8,
      horizontalAlign: "center",
    },
  };
}

function base(id: string, x: number, y: number, width: number, height: number) {
  return {
    id,
    name: id,
    geometry: { x, y, width, height, rotation: 0 },
    responsiveLayout: {
      width: { value: width, unit: "px" },
      height: { value: height, unit: "px" },
      horizontalConstraint: "left",
      verticalConstraint: "top",
      visible: true,
    },
    zIndex: 1,
    locked: false,
    hidden: false,
  };
}

await main();
