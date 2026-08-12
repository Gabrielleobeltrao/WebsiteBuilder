import { createProjectDocument, elementDefinition, FORM_CONTROL_FIELDS, type FormDefinitionInput } from "@websitebuilder/shared";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { COLLECTIONS } from "../src/db/indexes";
import { BlogRepository } from "../src/modules/blog/repository";
import { ensureFormIndexes, FORM_COLLECTIONS, FormRepository } from "../src/modules/forms/repository";
import { MediaRepository } from "../src/modules/media/repository";
import { createGridFsStorage } from "../src/modules/media/storage";
import { ProjectRepository, type WorkspaceContext } from "../src/modules/projects/repository";
import { ensurePublishingIndexes, PublishingRepository } from "../src/modules/publishing/repository";
import { PublishingService } from "../src/modules/publishing/service";
import { createRendererApp } from "../src/renderer/app";
import { createFormSubmissionRouter, formSubmissionPath } from "../src/renderer/forms";
import { SiteResolver } from "../src/renderer/resolver";
import { testEnv, testLogger } from "./helpers";
import { startTestDatabase, type TestDatabase } from "./mongo";

/**
 * The public submission endpoint.
 *
 * The second place in the product where an unauthenticated stranger can cause a write. Every test
 * here is a way that write could go somewhere it should not, or a way a real visitor's answer could
 * be lost.
 */
let database: TestDatabase;
let projects: ProjectRepository;
let publishing: PublishingRepository;
let forms: FormRepository;
let service: PublishingService;
let resolver: SiteResolver;

const A: WorkspaceContext = { workspaceId: "workspace-a", userId: "user-a" };
const B: WorkspaceContext = { workspaceId: "workspace-b", userId: "user-b" };
const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

const definition = (overrides: Partial<FormDefinitionInput> = {}): FormDefinitionInput => ({
  name: "Contact",
  fields: [
    { id: "name", type: "shortText", label: "Your name", required: true },
    { id: "email", type: "email", label: "Email", required: true },
  ],
  submitLabel: "Send",
  successBehavior: { type: "message", message: "Thank you." },
  notificationRecipients: [],
  ...overrides,
});

function app(overrides: Partial<Parameters<typeof createFormSubmissionRouter>[0]> = {}) {
  const router = createFormSubmissionRouter({
    resolver,
    forms,
    logger: testLogger(),
    trustsProxy: false,
    ...overrides,
  } as Parameters<typeof createFormSubmissionRouter>[0]);

  return createRendererApp({ env: testEnv(), logger: testLogger(), resolver, forms: router });
}

/** Publishes a site whose home page shows one form. */
async function liveSite(context: WorkspaceContext, name: string, subdomain: string, overrides: Partial<FormDefinitionInput> = {}) {
  const project = await projects.create(context, { name });
  const form = await forms.create(context, project.id, definition(overrides));

  const { id, workspaceId, createdByUserId, revision, createdAt, updatedAt, ...document } = project;
  const typed = document as ReturnType<typeof createProjectDocument>;
  typed.pages[0]!.sections[0]!.elements = [
    {
      id: "form-block",
      name: "",
      geometry: { x: 0, y: 0, width: 480, height: 360, rotation: 0 },
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
      type: "form",
      version: elementDefinition("form").schemaVersion,
      ...elementDefinition("form").defaults(),
      formId: form.id,
    },
  ] as never;

  const saved = await projects.saveDocument(context, project.id, revision, typed);
  if (saved === null) throw new Error(`saveDocument rejected the ${name} fixture`);

  const published = await service.publish(context, project.id);
  if (published.status !== "published") {
    throw new Error(`publishing ${name} returned ${published.status}: ${JSON.stringify(published)}`);
  }

  const domain = await publishing.ensurePlatformDomain(context, project.id, subdomain, "example.test");
  if (domain === null) throw new Error(`no platform hostname for ${name}`);
  resolver.invalidateAll();

  return { projectId: project.id, formId: form.id };
}

const post = (application: ReturnType<typeof app>, host: string, formId: string, body: Record<string, string>) =>
  request(application)
    .post(formSubmissionPath(formId))
    .set("Host", host)
    .set("User-Agent", BROWSER)
    .type("form")
    .send(body);

const submissions = () => database.db.collection(FORM_COLLECTIONS.submissions).find({}).toArray();

beforeAll(async () => {
  database = await startTestDatabase();
  projects = new ProjectRepository(database.db);
  publishing = new PublishingRepository(database.db, database.db.collection(COLLECTIONS.projects));
  forms = new FormRepository(database.db);
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

describe("a visitor with no JavaScript", () => {
  it("posts an ordinary form and is sent back to the page with a success marker", async () => {
    const site = await liveSite(A, "Alpha", "alpha");

    const response = await post(app(), "alpha.example.test", site.formId, {
      name: "Ana",
      email: "ana@example.test",
      [FORM_CONTROL_FIELDS.path]: "/",
    });

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe(`/?wb_form_ok=${site.formId}`);

    const stored = await submissions();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      workspaceId: A.workspaceId,
      projectId: site.projectId,
      values: { name: "Ana", email: "ana@example.test" },
    });
  });

  it("is sent back with an error marker when an answer is missing", async () => {
    const site = await liveSite(A, "Alpha", "alpha");

    const response = await post(app(), "alpha.example.test", site.formId, { name: "Ana", [FORM_CONTROL_FIELDS.path]: "/" });

    expect(response.status).toBe(303);
    expect(response.headers.location).toContain("wb_form_error");
    expect(await submissions()).toHaveLength(0);
  });
});

describe("what a caller cannot decide", () => {
  it("takes the tenant from the hostname, never from the body", async () => {
    const alpha = await liveSite(A, "Alpha", "alpha");
    await liveSite(B, "Beta", "beta");

    await post(app(), "alpha.example.test", alpha.formId, {
      name: "Ana",
      email: "ana@example.test",
      [FORM_CONTROL_FIELDS.path]: "/",
      workspaceId: B.workspaceId,
      projectId: "somebody-else",
    });

    const stored = await submissions();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ workspaceId: A.workspaceId, projectId: alpha.projectId });
  });

  it("refuses a form belonging to another site on this hostname", async () => {
    await liveSite(A, "Alpha", "alpha");
    const beta = await liveSite(B, "Beta", "beta");

    const response = await post(app(), "alpha.example.test", beta.formId, {
      name: "Ana",
      email: "ana@example.test",
      [FORM_CONTROL_FIELDS.path]: "/",
    });

    expect(response.status).toBe(404);
    expect(await submissions()).toHaveLength(0);
  });

  it("stores only the fields the published form declared", async () => {
    const site = await liveSite(A, "Alpha", "alpha");

    await post(app(), "alpha.example.test", site.formId, {
      name: "Ana",
      email: "ana@example.test",
      isAdmin: "true",
      status: "read",
      [FORM_CONTROL_FIELDS.path]: "/",
    });

    const stored = await submissions();
    expect(Object.keys((stored[0] as unknown as { values: Record<string, unknown> }).values).sort()).toEqual(["email", "name"]);
    expect(stored[0]).toMatchObject({ status: "new" });
  });

  it("attributes a submission to a published page only", async () => {
    const site = await liveSite(A, "Alpha", "alpha");

    await post(app(), "alpha.example.test", site.formId, {
      name: "Ana",
      email: "ana@example.test",
      [FORM_CONTROL_FIELDS.path]: "/a-path-nobody-published",
    });

    const stored = await submissions();
    // The path is a hint, and an unpublished one is discarded rather than stored: a caller choosing
    // its own attribution is a caller writing rows nobody can account for.
    expect((stored[0] as unknown as { source?: { pageId?: string } }).source?.pageId).toBeUndefined();
  });

  it("answers an unknown hostname the way the page catch-all does", async () => {
    await liveSite(A, "Alpha", "alpha");
    const response = await post(app(), "nobody.example.test", "f1", { name: "Ana" });

    expect(response.status).toBe(404);
  });
});

describe("what is refused quietly", () => {
  it("takes nothing from something that filled the honeypot, and says it worked", async () => {
    const site = await liveSite(A, "Alpha", "alpha");

    const response = await post(app(), "alpha.example.test", site.formId, {
      name: "Ana",
      email: "ana@example.test",
      [FORM_CONTROL_FIELDS.honeypot]: "https://example.test",
      [FORM_CONTROL_FIELDS.path]: "/",
    });

    // Told it worked on purpose: a distinguishable rejection tells whatever sent it what to change.
    expect(response.status).toBe(303);
    expect(response.headers.location).toContain("wb_form_ok");
    expect(await submissions()).toHaveLength(0);
  });

  it("stores nothing for something announcing itself as a crawler", async () => {
    const site = await liveSite(A, "Alpha", "alpha");

    const response = await request(app())
      .post(formSubmissionPath(site.formId))
      .set("Host", "alpha.example.test")
      .set("User-Agent", "Googlebot/2.1")
      .type("form")
      .send({ name: "Ana", email: "ana@example.test" });

    expect(response.status).toBe(303);
    expect(await submissions()).toHaveLength(0);
  });

  it("refuses more than a handful of submissions a minute from one project", async () => {
    const site = await liveSite(A, "Alpha", "alpha");
    const application = app({ limits: { perAddress: 100, perProject: 2, windowMs: 60_000 } });

    for (let index = 0; index < 2; index += 1) {
      const accepted = await post(application, "alpha.example.test", site.formId, {
        name: `Person ${index}`,
        email: `person${index}@example.test`,
        [FORM_CONTROL_FIELDS.path]: "/",
      });
      expect(accepted.status).toBe(303);
    }

    const refused = await post(application, "alpha.example.test", site.formId, {
      name: "Third",
      email: "third@example.test",
      [FORM_CONTROL_FIELDS.path]: "/",
    });
    expect(refused.status).toBe(429);
  });
});

describe("what a submission remembers", () => {
  it("keeps the revision and the questions it was answering", async () => {
    const site = await liveSite(A, "Alpha", "alpha");

    await post(app(), "alpha.example.test", site.formId, {
      name: "Ana",
      email: "ana@example.test",
      [FORM_CONTROL_FIELDS.path]: "/",
    });

    const stored = (await submissions())[0] as unknown as { formRevision: number; fields: Array<{ id: string; label: string }> };
    expect(stored.formRevision).toBe(1);
    expect(stored.fields.map((field) => field.label)).toEqual(["Your name", "Email"]);
  });

  it("validates against the published revision, not a definition edited since", async () => {
    const site = await liveSite(A, "Alpha", "alpha");

    // The live definition now demands a field the published page never showed.
    await forms.update(
      A,
      site.projectId,
      site.formId,
      definition({ fields: [{ id: "budget", type: "shortText", label: "Budget", required: true }] }),
      { expectedRevision: 1 },
    );

    const response = await post(app(), "alpha.example.test", site.formId, {
      name: "Ana",
      email: "ana@example.test",
      [FORM_CONTROL_FIELDS.path]: "/",
    });

    // A visitor half-way through filling in a form must not have the questions changed under them.
    expect(response.headers.location).toContain("wb_form_ok");
    expect((await submissions())[0]).toMatchObject({ formRevision: 1, values: { name: "Ana" } });
  });
});

describe("the published page itself", () => {
  it("renders the form the snapshot froze, posting to this origin", async () => {
    const site = await liveSite(A, "Alpha", "alpha");

    const page = await request(app()).get("/").set("Host", "alpha.example.test");

    expect(page.status).toBe(200);
    expect(page.text).toContain(`action="${formSubmissionPath(site.formId)}"`);
    expect(page.text).toContain('name="name"');
    expect(page.text).toContain("Your name");
  });

  it("keeps form-action to this origin only", async () => {
    await liveSite(A, "Alpha", "alpha");
    const page = await request(app()).get("/").set("Host", "alpha.example.test");

    expect(page.headers["content-security-policy"]).toContain("form-action 'self'");
  });
});
