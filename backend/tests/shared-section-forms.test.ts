import { createEmptySection, DEFAULT_FORM_PRESENTATION, type BuilderDocumentInput } from "@websitebuilder/shared";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { COLLECTIONS } from "../src/db/indexes";
import { BlogRepository } from "../src/modules/blog/repository";
import { ensureFormIndexes, FormRepository } from "../src/modules/forms/repository";
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
 * A form in a shared header or footer.
 *
 * Which is where a contact form usually goes, because it belongs on every page. The compiler
 * collected form references from `pages` alone, so the block passed the readiness audit — that walks
 * the resolved page and does see it — and its definition was left out of the snapshot. The published
 * page then rendered a form that "no longer exists": audited as fine, published as broken.
 */
let database: TestDatabase;
let projects: ProjectRepository;
let forms: FormRepository;
let publishing: PublishingRepository;
let service: PublishingService;
let resolver: SiteResolver;

const A: WorkspaceContext = { workspaceId: "workspace-a", userId: "user-a" };
const B: WorkspaceContext = { workspaceId: "workspace-b", userId: "user-b" };
const HOST = "shared.example.test";

beforeAll(async () => {
  database = await startTestDatabase();
  projects = new ProjectRepository(database.db);
  forms = new FormRepository(database.db);
  publishing = new PublishingRepository(database.db, database.db.collection(COLLECTIONS.projects));
  service = new PublishingService({
    projects,
    publishing,
    blog: new BlogRepository(database.db),
    media: new MediaRepository(database.db, createGridFsStorage(database.db)),
    loadForms: async (context, projectId) =>
      (await forms.list(context, projectId)).map((form) => ({
        id: form.id,
        name: form.name,
        revision: form.revision,
        fields: form.fields,
        submitLabel: form.submitLabel,
        successBehavior: form.successBehavior,
        status: form.archived ? ("archived" as const) : form.status,
      })),
  });
  resolver = new SiteResolver(publishing, 60);
}, 120_000);

afterAll(async () => {
  await database?.stop();
});

beforeEach(async () => {
  await database.clear();
  await ensurePublishingIndexes(database.db);
  await ensureFormIndexes(database.db);
  resolver.invalidateAll();
});

const formBlock = (formId: string) =>
  ({
    id: "shared-form-block",
    name: "",
    type: "form",
    version: 2,
    formId,
    presentation: DEFAULT_FORM_PRESENTATION,
    geometry: { x: 40, y: 40, width: 480, height: 360, rotation: 0 },
    responsiveLayout: {
      width: { value: 480, unit: "px" },
      height: { value: 360, unit: "px" },
      horizontalConstraint: "left",
      verticalConstraint: "top",
      visible: true,
    },
    zIndex: 1,
    locked: false,
    hidden: false,
  }) as never;

/** A site whose shared header carries the form, referenced from the home page. */
async function siteWithSharedForm(context: WorkspaceContext, hostLabel: string) {
  const project = await projects.create(context, { name: "Shared" });
  const form = await forms.create(context, project.id, {
    name: "Contact",
    fields: [{ id: "email", type: "email", label: "Your email", required: true }],
    submitLabel: "Send",
    successBehavior: { type: "message", message: "Thanks." },
    notificationRecipients: [],
  });

  const loaded = await projects.findById(context, project.id);
  const { id, workspaceId, createdByUserId, revision, createdAt, updatedAt, ...document } = loaded!;
  const typed = document as BuilderDocumentInput;

  const shared = { ...createEmptySection(), id: "shared-header", name: "Header", elements: [formBlock(form.id)] };
  typed.sharedSections = [shared];
  typed.pages[0]!.sections = [
    { ...createEmptySection(), id: "header-ref", elements: [], sharedSectionId: shared.id },
  ];

  expect(await projects.saveDocument(context, project.id, revision, typed)).not.toBeNull();
  const domain = await publishing.ensurePlatformDomain(context, project.id, hostLabel, "example.test");
  expect(domain).not.toBeNull();
  resolver.invalidateAll();

  return { projectId: project.id, formId: form.id };
}

describe("a form in a shared section", () => {
  it("reaches the published snapshot", async () => {
    const { projectId, formId } = await siteWithSharedForm(A, HOST.split(".")[0]!);

    const published = await service.publish(A, projectId);
    expect(published.status, JSON.stringify(published)).toBe("published");

    const version = published.status === "published" ? published.version : null;
    expect(version?.forms?.map((form) => form.id)).toContain(formId);
  });

  it("renders its fields on the public page", async () => {
    const { projectId } = await siteWithSharedForm(A, HOST.split(".")[0]!);
    expect((await service.publish(A, projectId)).status).toBe("published");

    const page = await request(createRendererApp({ env: testEnv(), logger: testLogger(), resolver }))
      .get("/")
      .set("host", HOST);

    expect(page.status).toBe(200);
    // A definition missing from the snapshot renders as "this form no longer exists".
    expect(page.text).toContain("Your email");
    expect(page.text).not.toContain("no longer exists");
  });

  it("counts a header shown on every page once", async () => {
    const { projectId, formId } = await siteWithSharedForm(A, HOST.split(".")[0]!);
    const published = await service.publish(A, projectId);

    const ids = published.status === "published" ? (published.version.forms ?? []).map((form) => form.id) : [];
    expect(ids.filter((id) => id === formId)).toHaveLength(1);
  });

  it("still leaves an unreferenced form out", async () => {
    const { projectId } = await siteWithSharedForm(A, HOST.split(".")[0]!);
    const unused = await forms.create(A, projectId, {
      name: "Unused",
      fields: [{ id: "note", type: "shortText", label: "Note", required: false }],
      submitLabel: "Send",
      successBehavior: { type: "message", message: "Thanks." },
      notificationRecipients: [],
    });

    const published = await service.publish(A, projectId);
    const ids = published.status === "published" ? (published.version.forms ?? []).map((form) => form.id) : [];

    expect(ids).not.toContain(unused.id);
  });

  it("never reaches another tenant's form", async () => {
    const mine = await siteWithSharedForm(A, "mine");
    const theirs = await siteWithSharedForm(B, "theirs");

    const published = await service.publish(A, mine.projectId);
    const ids = published.status === "published" ? (published.version.forms ?? []).map((form) => form.id) : [];

    expect(ids).toContain(mine.formId);
    expect(ids).not.toContain(theirs.formId);
  });
});
