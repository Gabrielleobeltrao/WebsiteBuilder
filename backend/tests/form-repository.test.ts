import type { FormDefinitionInput, FormField } from "@websitebuilder/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ensureFormIndexes, FormRepository } from "../src/modules/forms/repository";
import type { WorkspaceContext } from "../src/modules/projects/repository";
import { startTestDatabase, type TestDatabase } from "./mongo";

let database: TestDatabase;
let repository: FormRepository;

const A: WorkspaceContext = { workspaceId: "workspace-a", userId: "user-a" };
const B: WorkspaceContext = { workspaceId: "workspace-b", userId: "user-b" };
const PROJECT = "project-1";

const field = (overrides: Partial<FormField> = {}): FormField => ({
  id: "name",
  type: "shortText",
  label: "Your name",
  required: true,
  ...overrides,
});

const definition = (overrides: Partial<FormDefinitionInput> = {}): FormDefinitionInput => ({
  name: "Contact",
  fields: [field(), field({ id: "email", type: "email", label: "Email" })],
  submitLabel: "Send",
  successBehavior: { type: "message", message: "Thanks!" },
  notificationRecipients: [],
  ...overrides,
});

beforeAll(async () => {
  database = await startTestDatabase();
  await ensureFormIndexes(database.db);
  repository = new FormRepository(database.db);
}, 120_000);

afterAll(async () => {
  await database?.stop();
});

beforeEach(async () => {
  await database.clear();
  await ensureFormIndexes(database.db);
});

describe("definitions", () => {
  it("derives status from the checklist rather than trusting the caller", async () => {
    const ready = await repository.create(A, PROJECT, definition());
    expect(ready.status).toBe("ready");

    const incomplete = await repository.create(A, PROJECT, definition({ fields: [] }));
    expect(incomplete.status).toBe("needs_setup");
  });

  it("recomputes status on update", async () => {
    const created = await repository.create(A, PROJECT, definition());
    const updated = await repository.update(A, PROJECT, created.id, definition({ fields: [] }));
    expect(updated?.status).toBe("needs_setup");
  });

  it("is not readable or writable from another workspace", async () => {
    const created = await repository.create(A, PROJECT, definition());

    expect(await repository.list(B, PROJECT)).toEqual([]);
    expect(await repository.findById(B, PROJECT, created.id)).toBeNull();
    expect(await repository.update(B, PROJECT, created.id, definition({ name: "Stolen" }))).toBeNull();
  });
});

describe("public submission", () => {
  it("accepts a valid submission", async () => {
    const form = await repository.create(A, PROJECT, definition());
    const result = await repository.submit({
      projectId: PROJECT,
      formId: form.id,
      values: { name: "Ana", email: "ana@example.com" },
    });

    expect(result.accepted).toBe(true);
    const stored = await repository.listSubmissions(A, PROJECT, form.id);
    expect(stored.total).toBe(1);
    expect(stored.items[0]?.values).toEqual({ name: "Ana", email: "ana@example.com" });
  });

  it("stores only declared fields, never the raw payload", async () => {
    const form = await repository.create(A, PROJECT, definition());
    await repository.submit({
      projectId: PROJECT,
      formId: form.id,
      values: { name: "Ana", email: "ana@example.com", secret: "leak", workspaceId: "workspace-b" },
    });

    const stored = await repository.listSubmissions(A, PROJECT, form.id);
    expect(stored.items[0]?.values).not.toHaveProperty("secret");
    expect(stored.items[0]?.values).not.toHaveProperty("workspaceId");
  });

  it("rejects an invalid submission and stores nothing", async () => {
    const form = await repository.create(A, PROJECT, definition());
    const result = await repository.submit({ projectId: PROJECT, formId: form.id, values: { name: "Ana" } });

    expect(result.accepted).toBe(false);
    expect(result.errors.map((error) => error.fieldId)).toEqual(["email"]);
    expect((await repository.listSubmissions(A, PROJECT, form.id)).total).toBe(0);
  });

  it("answers identically for an unknown form, revealing nothing about what exists", async () => {
    const unknown = await repository.submit({
      projectId: PROJECT,
      formId: "aaaaaaaaaaaaaaaaaaaaaaaa",
      values: {},
    });
    const malformed = await repository.submit({ projectId: PROJECT, formId: "nope", values: {} });

    expect(unknown).toEqual({ accepted: false, errors: [] });
    expect(malformed).toEqual({ accepted: false, errors: [] });
  });

  it("cannot submit to a form belonging to another project", async () => {
    const form = await repository.create(A, PROJECT, definition());
    const result = await repository.submit({
      projectId: "other-project",
      formId: form.id,
      values: { name: "Ana", email: "ana@example.com" },
    });
    expect(result.accepted).toBe(false);
  });

  it("suppresses a duplicate but still reports success to the visitor", async () => {
    const form = await repository.create(A, PROJECT, definition());
    const values = { name: "Ana", email: "ana@example.com" };

    await repository.submit({ projectId: PROJECT, formId: form.id, values });
    const second = await repository.submit({ projectId: PROJECT, formId: form.id, values });

    // Telling the visitor it failed would make them submit again.
    expect(second.accepted).toBe(true);
    expect((await repository.listSubmissions(A, PROJECT, form.id)).total).toBe(1);
  });

  it("accepts the same content again once the window has passed", async () => {
    const form = await repository.create(A, PROJECT, definition());
    const values = { name: "Ana", email: "ana@example.com" };

    await repository.submit({ projectId: PROJECT, formId: form.id, values, now: new Date("2026-08-10T10:00:00Z") });
    await repository.submit({ projectId: PROJECT, formId: form.id, values, now: new Date("2026-08-10T12:00:00Z") });

    expect((await repository.listSubmissions(A, PROJECT, form.id)).total).toBe(2);
  });

  it("refuses submissions to an archived form", async () => {
    const form = await repository.create(A, PROJECT, definition());
    await repository.submit({ projectId: PROJECT, formId: form.id, values: { name: "A", email: "a@b.com" } });
    await repository.removeOrArchive(A, PROJECT, form.id);

    const result = await repository.submit({
      projectId: PROJECT,
      formId: form.id,
      values: { name: "B", email: "b@c.com" },
    });
    expect(result.accepted).toBe(false);
  });
});

describe("reference-aware removal", () => {
  it("deletes an unused definition", async () => {
    const form = await repository.create(A, PROJECT, definition());
    expect(await repository.removeOrArchive(A, PROJECT, form.id)).toBe("deleted");
    expect(await repository.findById(A, PROJECT, form.id)).toBeNull();
  });

  it("archives rather than deleting once submissions exist", async () => {
    const form = await repository.create(A, PROJECT, definition());
    await repository.submit({ projectId: PROJECT, formId: form.id, values: { name: "A", email: "a@b.com" } });

    expect(await repository.removeOrArchive(A, PROJECT, form.id)).toBe("archived");

    // The definition and every submission survive and stay reachable.
    expect((await repository.findById(A, PROJECT, form.id))?.archived).toBe(true);
    expect((await repository.listSubmissions(A, PROJECT, form.id)).total).toBe(1);
  });

  it("restores an archived definition", async () => {
    const form = await repository.create(A, PROJECT, definition());
    await repository.submit({ projectId: PROJECT, formId: form.id, values: { name: "A", email: "a@b.com" } });
    await repository.removeOrArchive(A, PROJECT, form.id);

    const restored = await repository.restore(A, PROJECT, form.id);
    expect(restored?.archived).toBe(false);
    expect(restored?.status).toBe("ready");
  });
});

describe("submission management", () => {
  it("marks a submission read, archived or spam", async () => {
    const form = await repository.create(A, PROJECT, definition());
    await repository.submit({ projectId: PROJECT, formId: form.id, values: { name: "A", email: "a@b.com" } });
    const [submission] = (await repository.listSubmissions(A, PROJECT, form.id)).items;

    const updated = await repository.setSubmissionStatus(A, PROJECT, submission!.id, "spam");
    expect(updated?.status).toBe("spam");
  });

  it("does not read, update or delete submissions across workspaces", async () => {
    const form = await repository.create(A, PROJECT, definition());
    await repository.submit({ projectId: PROJECT, formId: form.id, values: { name: "A", email: "a@b.com" } });
    const [submission] = (await repository.listSubmissions(A, PROJECT, form.id)).items;

    expect((await repository.listSubmissions(B, PROJECT, form.id)).total).toBe(0);
    expect(await repository.setSubmissionStatus(B, PROJECT, submission!.id, "spam")).toBeNull();
    expect(await repository.deleteSubmission(B, PROJECT, submission!.id)).toBe(false);
  });

  it("applies retention only within its own workspace", async () => {
    const formA = await repository.create(A, PROJECT, definition());
    const formB = await repository.create(B, PROJECT, definition());

    const old = new Date("2026-01-01T00:00:00Z");
    await repository.submit({ projectId: PROJECT, formId: formA.id, values: { name: "A", email: "a@b.com" }, now: old });
    await repository.submit({ projectId: PROJECT, formId: formB.id, values: { name: "B", email: "b@c.com" }, now: old });

    const deleted = await repository.applyRetention(A, PROJECT, formA.id, 30, new Date("2026-08-10T00:00:00Z"));
    expect(deleted).toBe(1);
    expect((await repository.listSubmissions(B, PROJECT, formB.id)).total).toBe(1);
  });
});
