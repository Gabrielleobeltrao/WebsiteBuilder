import {
  migrateDocumentElements,
  migrateDocumentResponsive,
  walkElements,
  type BuilderDocumentInput,
} from "@websitebuilder/shared";
import {
  LEGACY_NESTED_TEXT,
  LEGACY_SHARED_TEXT,
  LEGACY_TOP_LEVEL_ID,
  LEGACY_TOP_LEVEL_TEXT,
  legacyProjectDocument,
} from "@websitebuilder/shared/legacy-fixtures";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { COLLECTIONS } from "../src/db/indexes";
import { BlogRepository } from "../src/modules/blog/repository";
import { MediaRepository } from "../src/modules/media/repository";
import { createGridFsStorage } from "../src/modules/media/storage";
import { ProjectRepository, type WorkspaceContext } from "../src/modules/projects/repository";
import { ensurePublishingIndexes, PublishingRepository } from "../src/modules/publishing/repository";
import { PublishingService } from "../src/modules/publishing/service";
import { createRendererApp } from "../src/renderer/app";
import { SiteResolver } from "../src/renderer/resolver";
import { testEnv, testLogger } from "./helpers";
import { startTestDatabase, type TestDatabase } from "./mongo";

/**
 * The journey a customer reported losing: edit a word, save, come back, publish, open the site.
 *
 * Every step here is the real one — the project repository, the publishing service and the public
 * renderer on the site's own hostname. What it adds to the suite is a document that is *old*: text
 * at the top level of a page, text inside a container, and text in a shared section. The transforms
 * this product runs on read and on publish disagree about which of those they visit, and a fixture
 * with only the first placement is why that disagreement was never noticed.
 *
 * The affected project is never read to build this. The shape comes from the report.
 */
let database: TestDatabase;
let projects: ProjectRepository;
let publishing: PublishingRepository;
let service: PublishingService;
let resolver: SiteResolver;

const A: WorkspaceContext = { workspaceId: "workspace-a", userId: "user-a" };
const HOST = "legacy.example.test";

const renderer = () => createRendererApp({ env: testEnv(), logger: testLogger(), resolver });

beforeAll(async () => {
  database = await startTestDatabase();
  projects = new ProjectRepository(database.db);
  publishing = new PublishingRepository(database.db, database.db.collection(COLLECTIONS.projects));
  service = new PublishingService({
    projects,
    publishing,
    blog: new BlogRepository(database.db),
    media: new MediaRepository(database.db, createGridFsStorage(database.db)),
  });
  resolver = new SiteResolver(publishing, 60);
}, 120_000);

afterAll(async () => {
  await database?.stop();
});

beforeEach(async () => {
  await database.clear();
  await ensurePublishingIndexes(database.db);
  resolver.invalidateAll();
});

/** Stores the old document as the record a customer already has, and gives the site an address. */
async function storedLegacySite() {
  const project = await projects.create(A, { name: "Legacy" });
  const loaded = await projects.findById(A, project.id);

  const saved = await projects.saveDocument(A, project.id, loaded!.revision, legacyProjectDocument());
  if (saved === null) throw new Error("the legacy fixture was refused by the document schema");

  const domain = await publishing.ensurePlatformDomain(A, project.id, HOST.split(".")[0]!, "example.test");
  if (domain === null) throw new Error("no platform hostname for the legacy fixture");

  resolver.invalidateAll();
  return { projectId: project.id, revision: saved.revision };
}

/** What the builder does on read: migrate in memory, never writing until somebody saves. */
function asTheEditorReadsIt(document: BuilderDocumentInput): BuilderDocumentInput {
  const { document: versioned } = migrateDocumentElements(document as never);
  const { document: responsive } = migrateDocumentResponsive(versioned as never);
  return responsive as BuilderDocumentInput;
}

/*
 * These are written against the behaviour the product promises and fail against the behaviour it
 * has, so they are declared as expected failures rather than skipped. `it.fails` runs the body: it
 * passes only while the defect is present and turns red the moment the fix lands, which is what
 * forces the marker to be removed in the same change rather than left behind as a lie.
 */
describe("an old document, edited and published", () => {
  it.fails("keeps every paragraph through save, reload, publish and the public page", async () => {
    const { projectId, revision } = await storedLegacySite();

    // Read it back the way the editor does, edit one word, and save with the revision in hand.
    const stored = await projects.findById(A, projectId);
    const { id, workspaceId, createdByUserId, revision: _r, createdAt, updatedAt, ...rest } = stored!;
    const edited = asTheEditorReadsIt(rest as BuilderDocumentInput);

    const target = [...walkElements(edited.pages[0]!.sections[0]!.elements)].find(
      (element) => element.id === LEGACY_TOP_LEVEL_ID,
    );
    expect(target, "the fixture should carry a top-level paragraph").toBeDefined();
    (target as { content: string }).content = "Top level paragraph, edited";

    const savedAgain = await projects.saveDocument(A, projectId, revision, edited as never);
    expect(savedAgain, "saving an old document must not be refused").not.toBeNull();

    // Reload, then publish, then read what a visitor receives.
    const reloaded = await projects.findById(A, projectId);
    expect(JSON.stringify(reloaded)).toContain("Top level paragraph, edited");

    const published = await service.publish(A, projectId);
    expect(published.status, JSON.stringify(published)).toBe("published");

    const page = await request(renderer()).get("/").set("host", HOST);
    expect(page.status).toBe(200);

    expect(page.text).toContain("Top level paragraph, edited");
    // A container's child and a shared section's text are on the page a visitor opens, and are the
    // two placements the document-wide transforms do not reach.
    expect(page.text).toContain(LEGACY_NESTED_TEXT);
    expect(page.text).toContain(LEGACY_SHARED_TEXT);
  });

  it.fails("places every paragraph it draws, rather than drawing some with no rule", async () => {
    const { projectId } = await storedLegacySite();
    expect((await service.publish(A, projectId)).status).toBe("published");

    const page = await request(renderer()).get("/").set("host", HOST);

    // Free sections position by compiled rule. A rendered element with no rule is drawn at the
    // section origin on top of whatever else is there, which is what "the text disappeared" looks
    // like from the outside.
    for (const text of [LEGACY_TOP_LEVEL_TEXT, LEGACY_NESTED_TEXT, LEGACY_SHARED_TEXT]) {
      expect(page.text, text).toContain(text);
    }
    expect(page.text).toContain("legacy-nested");
    expect(page.text.split('[data-element-id="legacy-nested"]').length - 1).toBeGreaterThan(0);
  });
});
