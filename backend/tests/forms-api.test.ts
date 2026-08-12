import type { FormDefinitionInput } from "@websitebuilder/shared";
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
});

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
