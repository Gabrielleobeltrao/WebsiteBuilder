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
import {
  createEmptySection,
  createPage,
  DEFAULT_ANALYTICS_SETTINGS,
  DEFAULT_FORM_PRESENTATION,
  elementDefinition,
  type AnalyticsSettings,
} from "@websitebuilder/shared";

import { connectDatabase } from "../../../backend/src/db/client";
import { loadEnv } from "../../../backend/src/config/env";
import { createLogger } from "../../../backend/src/config/logger";
import { COLLECTIONS, ensureIndexes } from "../../../backend/src/db/indexes";
import { AnalyticsRepository, ensureAnalyticsIndexes } from "../../../backend/src/modules/analytics/repository";
import { BlogRepository } from "../../../backend/src/modules/blog/repository";
import { MediaRepository } from "../../../backend/src/modules/media/repository";
import { createGridFsStorage } from "../../../backend/src/modules/media/storage";
import { ProjectRepository } from "../../../backend/src/modules/projects/repository";
import { ensureFormIndexes, FormRepository } from "../../../backend/src/modules/forms/repository";
import { ensurePublishingIndexes, PublishingRepository } from "../../../backend/src/modules/publishing/repository";
import { PublishingService } from "../../../backend/src/modules/publishing/service";

/**
 * The hostnames browser tests visit. Kept in one place because the tests and the seed must agree.
 *
 * Three sites rather than one, because the states worth testing are properties of a site's
 * settings: a site that measures nothing must be provably free of script, and a site that requires
 * consent must be provably silent until it is given.
 */
export const E2E_SITE_SLUG = "e2e-site";
export const E2E_TRACKED_SLUG = "e2e-tracked";
export const E2E_CONSENT_SLUG = "e2e-consent";
export const E2E_FORM_SLUG = "e2e-form";
export const E2E_WORKSPACE_ID = "e2e-workspace";

const context = { workspaceId: E2E_WORKSPACE_ID, userId: "e2e-user" };

async function main(): Promise<void> {
  const env = loadEnv(process.env, "renderer");
  const logger = createLogger(env).child({ service: "e2e-seed" });
  const { db, close } = await connectDatabase(env, logger);

  await ensureIndexes(db);
  await ensurePublishingIndexes(db);
  await ensureAnalyticsIndexes(db);
  await ensureFormIndexes(db);

  const projects = new ProjectRepository(db);
  const forms = new FormRepository(db);
  const publishing = new PublishingRepository(db, db.collection(COLLECTIONS.projects));
  const service = new PublishingService({
    projects,
    publishing,
    blog: new BlogRepository(db),
    media: new MediaRepository(db, createGridFsStorage(db)),
    loadForms: async (workspace, projectId) =>
      (await forms.list(workspace, projectId)).map((form) => ({
        id: form.id,
        name: form.name,
        revision: form.revision,
        fields: form.fields,
        submitLabel: form.submitLabel,
        successBehavior: form.successBehavior,
        status: form.archived ? ("archived" as const) : form.status,
      })),
  });

  const analytics = new AnalyticsRepository(db);

  const publish = async (name: string, slug: string, settings?: Partial<AnalyticsSettings>, withForm = false) => {
    const project = await projects.create(context, { name });
    const { id, workspaceId, createdByUserId, revision, createdAt, updatedAt, ...document } = project;

    const home = document.pages[0]!;
    home.seo.title = "E2E home";
    home.seo.description = "A published page that exists so browser tests have somewhere to go.";
    // Taller than any test viewport, so scroll-depth behaviour is observable rather than trivially
    // complete on load.
    home.canvas = { ...home.canvas, minHeight: 4000 };
    home.sections = [
      section("hero", 800, [
        heading("Published by the E2E fixture"),
        button("cta-primary", "Read more", "/about"),
        nestedBox("nested-box", "nested-paragraph", "Text inside a container"),
      ]),
      section("middle", 1600, [heading("Halfway down")]),
      section("foot", 1600, [heading("The bottom")]),
    ];

    // One site carries a real form, so the submission journey has somewhere to post to.
    if (withForm) {
      const form = await forms.create(context, project.id, {
        name: "Contact",
        fields: [
          { id: "name", type: "shortText", label: "Your name", required: true },
          { id: "email", type: "email", label: "Email", required: true },
          { id: "message", type: "longText", label: "Message", required: false },
        ],
        submitLabel: "Send message",
        successBehavior: { type: "message", message: "Thank you. We will reply soon." },
        notificationRecipients: [],
      });

      home.sections.push(section("contact", 800, [formBlock(form.id)]) as never);
    }

    const about = createPage({ name: "About", slug: "about", order: 1 });
    about.seo = { ...about.seo, title: "E2E about", description: "The fixture's second route." };
    about.sections = [section("about-hero", 900, [heading("About the fixture")])];
    document.pages.push(about);

    const saved = await projects.saveDocument(context, project.id, revision, document as never);
    if (saved === null) throw new Error(`the seed document for ${slug} was rejected`);

    const published = await service.publish(context, project.id);
    if (published.status !== "published") {
      throw new Error(`seeding could not publish ${slug}: ${published.status} ${JSON.stringify(published)}`);
    }

    const domain = await publishing.ensurePlatformDomain(context, project.id, slug, env.PLATFORM_ROOT_DOMAIN);
    if (domain === null) throw new Error(`${slug} got no platform hostname`);

    if (settings !== undefined) {
      await analytics.saveSettings(context, project.id, { ...DEFAULT_ANALYTICS_SETTINGS, ...settings });
    }

    logger.info({ hostname: domain.hostname, projectId: project.id }, "seeded a published site");
  };

  // Collection off and no form: what every existing customer has, and the state that must be
  // provably free of script. A form on this site would put the interaction runtime on it and make
  // that claim untestable, so the form gets its own.
  await publish("E2E Site", E2E_SITE_SLUG);
  // Collection on with no consent gate, so measurement is observable in one page load.
  await publish("E2E Tracked", E2E_TRACKED_SLUG, { enabled: true, consentRequired: false });
  // Collection on behind consent, so silence before an answer is observable too.
  await publish("E2E Consent", E2E_CONSENT_SLUG, { enabled: true, consentRequired: true });
  // A real form, on its own site, so the submission journey has somewhere to post to.
  await publish("E2E Form", E2E_FORM_SLUG, undefined, true);

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

/**
 * A container holding text, which is the shape whose rules the compiler used to omit.
 *
 * The renderer always drew a container's children and the stylesheet never placed them, so in a free
 * container every child landed at the box's origin. That is invisible to a test that only looks at
 * top-level blocks, which is what every browser check here did.
 */
function nestedBox(id: string, childId: string, text: string) {
  return {
    ...base(id, 240, 40, 600, 220),
    type: "container",
    layout: "free",
    layoutByBreakpoint: {},
    children: [
      {
        ...base(childId, 24, 24, 400, 60),
        type: "text",
        tag: "p",
        content: text,
        style: {
          fontFamily: "Inter",
          fontSize: { value: 18, unit: "px" },
          fontWeight: 400,
          fontStyle: "normal",
          textAlign: "left",
          color: "#0d1424",
          lineHeight: 1.4,
        },
      },
    ],
  };
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
    // `newTab` is required by the link schema. The seed reached storage through the repository, so
    // nothing validated this until reads were given a parse boundary.
    link: { kind: "external", url: `https://example.test${path}`, newTab: false },
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

function formBlock(formId: string) {
  return {
    ...base("contact-form", 40, 40, 720, 520),
    type: "form",
    version: elementDefinition("form").schemaVersion,
    formId,
    presentation: { ...DEFAULT_FORM_PRESENTATION },
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
