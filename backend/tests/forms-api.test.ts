import { createProjectDocument, elementDefinition, type BuilderProject, type FormDefinitionInput } from "@websitebuilder/shared";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { createSeededWorkspaceResolver } from "../src/middleware/workspace";
import { ensureFormIndexes, FormRepository } from "../src/modules/forms/repository";
import { createFormsRouter } from "../src/modules/forms/routes";
import { testEnv, testLogger } from "./helpers";
import { startTestDatabase, type TestDatabase } from "./mongo";

/**
 * The authenticated form API, over HTTP.
 *
 * The repository tests prove the storage rules; these prove the contract a browser sees — the
 * status codes, the envelope, and the answer a second tab gets when it saves work made against a
 * revision that has moved on.
 */
const WORKSPACE = "workspace-a";
const PROJECT = "aaaaaaaaaaaaaaaaaaaaaaaa";
const base = `/api/v1/workspaces/${WORKSPACE}/projects/${PROJECT}/forms`;

let database: TestDatabase;
let app: Express;

/**
 * Where forms are placed, as the document would say.
 *
 * Set per test rather than by saving a whole builder document: what these tests are about is the
 * contract between the module and the document, not the document's own shape.
 */
let placements: Array<{ pageId: string; elementId: string; formId: string; shared: boolean }> = [];

/** The form revisions a live site would be serving, as the publishing module would report them. */
let live = new Map<string, number>();

const definition = (overrides: Partial<FormDefinitionInput> = {}): FormDefinitionInput => ({
  name: "Contact",
  fields: [{ id: "name", type: "shortText", label: "Your name", required: true }],
  submitLabel: "Send",
  successBehavior: { type: "message", message: "Thank you." },
  notificationRecipients: [],
  ...overrides,
});

beforeAll(async () => {
  database = await startTestDatabase();
  app = createApp({
    env: testEnv(),
    logger: testLogger(),
    routers: [
      {
        path: "/workspaces/:workspaceId/projects/:projectId/forms",
        router: createFormsRouter({
          repository: new FormRepository(database.db),
          resolveWorkspace: createSeededWorkspaceResolver({ workspaceId: WORKSPACE, userId: "user-a" }),
          loadProject: async () => projectWithPlacements(),
          loadPublishedRevisions: async () => live,
        }),
      },
    ],
  });
}, 120_000);

afterAll(async () => {
  await database?.stop();
});

beforeEach(async () => {
  await database.clear();
  await ensureFormIndexes(database.db);
  placements = [];
  live = new Map();
});

/** A saved document holding exactly the placements a test declared. */
function projectWithPlacements(): BuilderProject {
  const document = createProjectDocument({ name: "Acme", slug: "acme" });
  const page = document.pages[0]!;
  page.id = "home";

  const shared = placements.filter((placement) => placement.shared);
  const own = placements.filter((placement) => !placement.shared);

  page.sections[0]!.elements = own.map((placement) => formBlock(placement.elementId, placement.formId)) as never;

  if (shared.length > 0) {
    document.sharedSections = [
      {
        ...page.sections[0]!,
        id: "shared-header",
        role: "header",
        elements: shared.map((placement) => formBlock(placement.elementId, placement.formId)) as never,
      },
    ];
    page.sections.push({ ...page.sections[0]!, id: "header-ref", elements: [], sharedSectionId: "shared-header" });
  }

  return { ...document, id: PROJECT, workspaceId: WORKSPACE, createdByUserId: "user-a", revision: 1, createdAt: "", updatedAt: "" } as BuilderProject;
}

function formBlock(id: string, formId: string) {
  return {
    id,
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
    formId,
  };
}

async function createForm(overrides: Partial<FormDefinitionInput> = {}) {
  const response = await request(app).post(base).send(definition(overrides));
  expect(response.status).toBe(201);
  return response.body.data as { id: string; revision: number; status: string };
}

describe("definitions", () => {
  it("creates one and reports the revision it starts at", async () => {
    const form = await createForm();
    expect(form.revision).toBe(1);
    expect(form.status).toBe("ready");
  });

  it("refuses a definition carrying a field nobody declared", async () => {
    const response = await request(app).post(base).send({ ...definition(), webhookUrl: "https://evil.test" });
    expect(response.status).toBe(400);
  });

  it("refuses a field id that would not be safe as an HTML name", async () => {
    const response = await request(app)
      .post(base)
      .send(definition({ fields: [{ id: "__wb_path", type: "shortText", label: "Trap", required: false }] }));

    expect(response.status).toBe(400);
  });
});

describe("saving against a stale revision", () => {
  it("answers 409 and says which revision is current", async () => {
    const form = await createForm();
    await request(app).put(`${base}/${form.id}`).send({ ...definition({ name: "First" }), expectedRevision: 1 });

    const second = await request(app)
      .put(`${base}/${form.id}`)
      .send({ ...definition({ name: "Second" }), expectedRevision: 1 });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("REVISION_CONFLICT");
    expect(JSON.stringify(second.body.error.details)).toContain("current revision is 2");

    // And the first save is still there, which is the whole point.
    const reloaded = await request(app).get(`${base}/${form.id}`);
    expect(reloaded.body.data.name).toBe("First");
  });

  it("refuses a save that does not say which revision it was made against", async () => {
    const form = await createForm();
    const response = await request(app).put(`${base}/${form.id}`).send(definition({ name: "Blind" }));

    expect(response.status).toBe(400);
  });

  it("answers 404 for a form this workspace does not have", async () => {
    const response = await request(app)
      .put(`${base}/ffffffffffffffffffffffff`)
      .send({ ...definition(), expectedRevision: 1 });

    expect(response.status).toBe(404);
  });
});

describe("usage and deletion", () => {
  it("reports where a form is placed, including inside a shared header", async () => {
    const form = await createForm();
    placements = [{ pageId: "home", elementId: "block-1", formId: form.id, shared: true }];

    const response = await request(app).get(base);
    expect(response.status).toBe(200);
    expect(response.body.data[0].usages).toEqual([
      expect.objectContaining({ formId: form.id, elementId: "block-1", shared: true }),
    ]);
  });

  it("refuses to delete a form a page still points at, and says where", async () => {
    const form = await createForm();
    placements = [{ pageId: "home", elementId: "block-1", formId: form.id, shared: false }];

    const response = await request(app).delete(`${base}/${form.id}`);

    // Never a silent delete: the block would keep an id that resolves to nothing and publish as a
    // set of inputs that take an answer and lose it.
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("RESOURCE_IN_USE");
    expect(JSON.stringify(response.body.error.details)).toContain("block-1");
    expect((await request(app).get(`${base}/${form.id}`)).status).toBe(200);
  });

  it("deletes an unreferenced form with no submissions", async () => {
    const form = await createForm();
    const response = await request(app).delete(`${base}/${form.id}`);

    expect(response.status).toBe(200);
    expect(response.body.data.outcome).toBe("deleted");
  });

  it("duplicates a form as a fresh record at revision one", async () => {
    const form = await createForm();
    await request(app).put(`${base}/${form.id}`).send({ ...definition({ name: "Edited" }), expectedRevision: 1 });

    const copy = await request(app).post(`${base}/${form.id}/duplicate`).send({ name: "Edited copy" });
    expect(copy.status).toBe(201);
    expect(copy.body.data).toMatchObject({ name: "Edited copy", revision: 1 });
    expect(copy.body.data.id).not.toBe(form.id);
  });
});

describe("the submissions inbox", () => {
  const send = async (formId: string, values: Record<string, unknown>, at: string, pageId = "home") => {
    const repository = new FormRepository(database.db);
    const result = await repository.submit({
      projectId: PROJECT,
      formId,
      values,
      source: { pageId, path: "/contact" },
      now: new Date(at),
      // Distinct content per call; duplicate suppression is proved in the repository tests.
      duplicateWindowMs: 0,
    });
    expect(result.accepted).toBe(true);
  };

  it("lists every form's answers newest first, with the counts the summary shows", async () => {
    const form = await createForm();
    await send(form.id, { name: "Ana" }, "2026-08-01T10:00:00Z");
    await send(form.id, { name: "Bruno" }, "2026-08-02T10:00:00Z");

    const response = await request(app).get(`${base}/-/submissions`);
    expect(response.status).toBe(200);
    expect(response.body.data.items.map((item: { values: { name: string } }) => item.values.name)).toEqual([
      "Bruno",
      "Ana",
    ]);
    expect(response.body.data.counts).toMatchObject({ new: 2, total: 2 });
  });

  it("filters by form, status, page and date without widening the tenant scope", async () => {
    const form = await createForm();
    const other = await createForm({ name: "Other" });
    await send(form.id, { name: "Ana" }, "2026-08-01T10:00:00Z");
    await send(other.id, { name: "Bruno" }, "2026-08-05T10:00:00Z", "about");

    const byForm = await request(app).get(`${base}/-/submissions`).query({ formId: form.id });
    expect(byForm.body.data.total).toBe(1);

    const byPage = await request(app).get(`${base}/-/submissions`).query({ pageId: "about" });
    expect(byPage.body.data.items[0].values.name).toBe("Bruno");

    const byDate = await request(app)
      .get(`${base}/-/submissions`)
      .query({ from: "2026-08-03T00:00:00.000Z" });
    expect(byDate.body.data.total).toBe(1);
  });

  it("marks a selection read and deletes another, one request each", async () => {
    const form = await createForm();
    await send(form.id, { name: "Ana" }, "2026-08-01T10:00:00Z");
    await send(form.id, { name: "Bruno" }, "2026-08-02T10:00:00Z");

    const listed = await request(app).get(`${base}/-/submissions`);
    const ids = listed.body.data.items.map((item: { id: string }) => item.id);

    const read = await request(app).patch(`${base}/-/submissions`).send({ ids, action: "read" });
    expect(read.body.data.changed).toBe(2);
    expect((await request(app).get(`${base}/-/submissions`)).body.data.counts).toMatchObject({ read: 2, new: 0 });

    const removed = await request(app).patch(`${base}/-/submissions`).send({ ids: [ids[0]], action: "delete" });
    expect(removed.body.data.changed).toBe(1);
    expect((await request(app).get(`${base}/-/submissions`)).body.data.total).toBe(1);
  });

  it("refuses a bulk action naming no submissions", async () => {
    const response = await request(app).patch(`${base}/-/submissions`).send({ ids: [], action: "read" });
    expect(response.status).toBe(400);
  });

  it("exports one form as a CSV that cannot execute in a spreadsheet", async () => {
    const form = await createForm();
    await send(form.id, { name: "=cmd|'/c calc'!A1" }, "2026-08-01T10:00:00Z");

    const response = await request(app).get(`${base}/${form.id}/submissions.csv`);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.headers["content-disposition"]).toContain("attachment");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    // Prefixed rather than stripped: the value stays readable and stops being a formula.
    expect(response.text).toContain(`"'=cmd|'/c calc'!A1"`);
  });
});

describe("readiness and lifecycle", () => {
  it("reports a form with no questions as a reason the site cannot publish", async () => {
    const empty = await createForm({ fields: [] });
    placements = [{ pageId: "home", elementId: "block-1", formId: empty.id, shared: false }];

    const { compileSite } = await import("@websitebuilder/shared");
    const result = compileSite({
      project: projectWithPlacements(),
      blog: { settings: { enabled: false } as never, posts: [] },
      cms: { collections: [], items: [] },
      redirects: [],
      forms: [
        {
          id: empty.id,
          name: "Contact",
          revision: 1,
          fields: [],
          submitLabel: "Send",
          successBehavior: { type: "message", message: "Thanks" },
          status: "needs_setup",
        },
      ],
      mediaExists: () => true,
      supportedSchemaVersion: 1,
      moduleBlockers: 0,
      maxDocumentBytes: 4_000_000,
    });

    const issue = result.report.issues.find((candidate) => candidate.blockCode === "form-without-fields");
    // Named the form rather than only the block: the fix is inside the definition, and a finding
    // that sends somebody to the block sends them to the one screen it cannot be corrected on.
    expect(issue).toBeDefined();
    expect(issue?.formId).toBe(empty.id);
  });

  it("says which revision the live site is serving, so a draft edit is visibly waiting", async () => {
    const form = await createForm();
    live = new Map([[form.id, 1]]);

    const before = await request(app).get(base);
    expect(before.body.data[0]).toMatchObject({ revision: 1, publishedRevision: 1 });

    await request(app).put(`${base}/${form.id}`).send({ ...definition({ name: "Edited" }), expectedRevision: 1 });

    const after = await request(app).get(base);
    expect(after.body.data[0]).toMatchObject({ revision: 2, publishedRevision: 1 });
  });

  it("archives a form that holds answers rather than destroying them", async () => {
    const form = await createForm();
    await new FormRepository(database.db).submit({
      projectId: PROJECT,
      formId: form.id,
      values: { name: "Ana" },
    });

    const response = await request(app).delete(`${base}/${form.id}`);
    expect(response.body.data.outcome).toBe("archived");

    // The inbox still reaches them, which is the whole reason archiving exists.
    const inbox = await request(app).get(`${base}/-/submissions`);
    expect(inbox.body.data.total).toBe(1);
  });

  it("restores an archived form without moving its revision", async () => {
    const form = await createForm();
    await new FormRepository(database.db).submit({ projectId: PROJECT, formId: form.id, values: { name: "Ana" } });
    await request(app).delete(`${base}/${form.id}`);

    const restored = await request(app).post(`${base}/${form.id}/restore`);
    expect(restored.body.data).toMatchObject({ archived: false, revision: 1 });
  });
});
