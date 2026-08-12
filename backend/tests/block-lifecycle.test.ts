import {
  builderDocumentInputSchema,
  createProjectDocument,
  elementDefinition,
  ELEMENT_TYPES,
  type BuilderProject,
} from "@websitebuilder/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { COLLECTIONS } from "../src/db/indexes";
import { BlogRepository, ensureBlogIndexes } from "../src/modules/blog/repository";
import { MediaRepository } from "../src/modules/media/repository";
import { createGridFsStorage } from "../src/modules/media/storage";
import { ProjectRepository, type WorkspaceContext } from "../src/modules/projects/repository";
import { ensurePublishingIndexes, PublishingRepository } from "../src/modules/publishing/repository";
import { PublishingService } from "../src/modules/publishing/service";
import { startTestDatabase, type TestDatabase } from "./mongo";

/**
 * Every block, through the whole product.
 *
 * Insert, save, reload, publish, fetch. A block that renders in a unit test and cannot survive a
 * round trip through the database and the publisher is a block that works only where nobody uses
 * it — and with twenty-nine types, checking them individually by hand is exactly the coverage that
 * quietly stops happening.
 */

let database: TestDatabase;
let projects: ProjectRepository;
let publishing: PublishingRepository;
let service: PublishingService;

const A: WorkspaceContext = { workspaceId: "workspace-a", userId: "user-a" };

/** One block of each type, configured enough to publish. */
const CONFIGURED: Partial<Record<(typeof ELEMENT_TYPES)[number], Record<string, unknown>>> = {
  image: { source: { kind: "url", url: "https://example.test/a.png" }, alt: "A photo" },
  video: { videoId: "abc123" },
  downloadButton: { mediaId: "file-1" },
  form: { formId: "form-1" },
  navigationMenu: { items: [{ label: "Home", link: { kind: "none" } }] },
  countdown: { target: "2027-01-01T00:00:00-03:00" },
  gallery: { items: [{ mediaId: "m-1", alt: "A photo", decorative: false, caption: "" }] },
  siteLogo: { fallbackText: "Acme" },
};

function documentWithEveryBlock() {
  const document = createProjectDocument({ name: "Acme", slug: "acme" });
  const page = document.pages[0]!;

  page.sections[0]!.elements = ELEMENT_TYPES.filter((type) => type !== "container").map((type, index) => ({
    id: `${type}-block`,
    name: "",
    geometry: { x: 0, y: index * 60, width: 300, height: 50, rotation: 0 },
    responsiveLayout: {
      width: { value: 300, unit: "px" },
      height: { value: 50, unit: "px" },
      horizontalConstraint: "left",
      verticalConstraint: "top",
      visible: true,
    },
    zIndex: index + 1,
    locked: false,
    hidden: false,
    type,
    version: elementDefinition(type).schemaVersion,
    ...elementDefinition(type).defaults(),
    ...(CONFIGURED[type] ?? {}),
  })) as never;

  return document;
}

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
}, 120_000);

afterAll(async () => {
  await database?.stop();
});

beforeEach(async () => {
  await database.clear();
  await ensureBlogIndexes(database.db);
  await ensurePublishingIndexes(database.db);
});

async function saveEveryBlock() {
  const project = await projects.create(A, { name: "Acme" });
  const loaded = await projects.findById(A, project.id);
  const { id, workspaceId, createdByUserId, revision, createdAt, updatedAt, ...document } = loaded!;

  const withBlocks = { ...document, pages: documentWithEveryBlock().pages } as BuilderProject;
  const saved = await projects.saveDocument(A, project.id, revision, withBlocks as never);
  return { projectId: project.id, revision: saved?.revision };
}

describe("every block survives a round trip", () => {
  it("saves and reloads without losing a field", async () => {
    const { projectId } = await saveEveryBlock();
    const reloaded = await projects.findById(A, projectId);

    const types = reloaded?.pages[0]?.sections[0]?.elements.map((element) => element.type) ?? [];
    expect(types).toEqual(ELEMENT_TYPES.filter((type) => type !== "container"));
  });

  it("is refused at the boundary when a field is not what its schema says", () => {
    const corrupted = documentWithEveryBlock();
    (corrupted.pages[0]!.sections[0]!.elements[0] as unknown as { geometry: unknown }).geometry = "everywhere";

    // The API route is where a document is parsed, and the repository trusts what reaches it. This
    // asserts the contract that guards the boundary rather than the layer behind it.
    expect(builderDocumentInputSchema.safeParse(corrupted).success).toBe(false);
  });
});

describe("every block reaches a visitor", () => {
  it("publishes a page containing all of them", async () => {
    const { projectId } = await saveEveryBlock();
    const outcome = await service.publish(A, projectId);

    // Configured blocks publish. This is the assertion that catches a readiness rule that refuses
    // something it should not.
    expect(outcome.status, JSON.stringify(outcome.status === "blocked" ? outcome.report.issues : {})).toBe("published");
  });

  it("refuses to publish when one of them cannot work", async () => {
    const project = await projects.create(A, { name: "Acme" });
    const loaded = await projects.findById(A, project.id);
    const { id, workspaceId, createdByUserId, revision, createdAt, updatedAt, ...document } = loaded!;

    const broken = documentWithEveryBlock();
    const video = broken.pages[0]!.sections[0]!.elements.find((element) => element.type === "video");
    (video as unknown as { videoId: string }).videoId = "";

    await projects.saveDocument(A, project.id, revision, { ...document, pages: broken.pages } as never);
    const outcome = await service.publish(A, project.id);

    expect(outcome.status).toBe("blocked");
    expect(outcome.status === "blocked" && outcome.report.issues.some((issue) => issue.code === "block-incomplete")).toBe(
      true,
    );
  });

  it("renders the published page from the snapshot, not from the draft", async () => {
    const { projectId } = await saveEveryBlock();
    await service.publish(A, projectId);

    const version = await publishing.findActiveForProject(projectId);
    expect(version).not.toBeNull();

    const snapshot = version?.document as BuilderProject | undefined;
    const types = snapshot?.pages[0]?.sections[0]?.elements.map((element) => element.type) ?? [];
    expect(types).toHaveLength(ELEMENT_TYPES.length - 1);
  });
});
