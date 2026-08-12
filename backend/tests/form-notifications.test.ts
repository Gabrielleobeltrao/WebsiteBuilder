import type { FormField } from "@websitebuilder/shared";
import { describe, expect, it, vi } from "vitest";

import { buildSubmissionCsv } from "../src/modules/forms/export";
import {
  buildNotificationPayload,
  createDevelopmentSink,
  notifySafely,
  type NotificationAdapter,
} from "../src/modules/forms/notifications";
import type { FormDefinition, FormSubmission } from "../src/modules/forms/repository";
import { testLogger } from "./helpers";

const field = (overrides: Partial<FormField> = {}): FormField => ({
  id: "name",
  type: "shortText",
  label: "Your name",
  required: true,
  ...overrides,
});

const definition = {
  name: "Contact",
  fields: [field(), field({ id: "consent", type: "consent", label: "I agree" }), field({ id: "utm", type: "hidden", label: "UTM" })],
  notificationRecipients: ["team@example.com"],
} as unknown as FormDefinition;

const submission = (values: Record<string, unknown> = {}): FormSubmission => ({
  id: "aaaaaaaaaaaaaaaaaaaaaaaa",
  workspaceId: "w1",
  projectId: "p1",
  formId: "f1",
  formRevision: 1,
  fields: [],
  values: { name: "Ana", consent: true, utm: "spring", ...values } as never,
  status: "new",
  createdAt: "2026-08-10T12:00:00.000Z",
});

describe("notification payload", () => {
  it("pairs stored values with their current labels", () => {
    const payload = buildNotificationPayload(definition, submission());
    expect(payload.fields).toEqual([
      { label: "Your name", value: "Ana" },
      { label: "I agree", value: "yes" },
    ]);
  });

  it("omits hidden attribution fields from what a human reads", () => {
    const payload = buildNotificationPayload(definition, submission());
    expect(payload.fields.map((f) => f.label)).not.toContain("UTM");
  });

  it("reads through a renamed label because values resolve by field id", () => {
    const renamed = { ...definition, fields: [field({ label: "Full name" })] } as FormDefinition;
    expect(buildNotificationPayload(renamed, submission()).fields[0]).toEqual({
      label: "Full name",
      value: "Ana",
    });
  });
});

describe("notifySafely", () => {
  it("never lets a provider failure surface, because the submission is already stored", async () => {
    const failing: NotificationAdapter = {
      name: "failing",
      send: () => Promise.reject(new Error("smtp unavailable")),
    };

    const result = await notifySafely(failing, buildNotificationPayload(definition, submission()), testLogger());
    expect(result).toEqual({ delivered: false, reason: "provider-error" });
  });

  it("reports rather than sends when no recipient is configured", async () => {
    const adapter = createDevelopmentSink(testLogger());
    const payload = { ...buildNotificationPayload(definition, submission()), recipients: [] };

    expect(await notifySafely(adapter, payload, testLogger())).toEqual({ delivered: false, reason: "no-recipients" });
    expect(adapter.sent).toHaveLength(0);
  });

  it("captures the payload in the development sink without contacting anything", async () => {
    const adapter = createDevelopmentSink(testLogger());
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await notifySafely(adapter, buildNotificationPayload(definition, submission()), testLogger());

    expect(result.delivered).toBe(true);
    expect(adapter.sent).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("CSV export", () => {
  it("uses current labels as headers and skips hidden fields", () => {
    const csv = buildSubmissionCsv(definition, [submission()]);
    const [header] = csv.split("\r\n");

    expect(header).toBe('"Submitted at","Status","Your name","I agree","Retired questions"');
    expect(header).not.toContain("UTM");
  });

  it("keeps an answer to a question the form no longer asks", () => {
    // A rename must not delete records. The label comes from the snapshot the submission carries,
    // so the cell says which question was actually answered.
    const withOldField = {
      ...submission(),
      fields: [{ id: "budget", type: "shortText" as const, label: "Your budget" }],
      values: { name: "Ana", consent: true, budget: "R$ 5.000" } as never,
    };

    expect(buildSubmissionCsv(definition, [withOldField])).toContain("Your budget: R$ 5.000");
  });

  it("renders booleans readably", () => {
    const csv = buildSubmissionCsv(definition, [submission({ consent: false })]);
    expect(csv).toContain('"no"');
  });

  it("leaves a missing value as an empty cell rather than undefined", () => {
    const csv = buildSubmissionCsv(definition, [submission({ name: undefined })]);
    expect(csv).toContain('""');
    expect(csv).not.toContain("undefined");
  });

  it("neutralises a formula a visitor submitted", () => {
    const csv = buildSubmissionCsv(definition, [submission({ name: "=HYPERLINK(\"http://evil\")" })]);
    expect(csv).toContain(`"'=HYPERLINK`);
  });

  it("exports one row per submission, newest order preserved from the caller", () => {
    const csv = buildSubmissionCsv(definition, [submission({ name: "First" }), submission({ name: "Second" })]);
    const rows = csv.split("\r\n");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain("First");
    expect(rows[2]).toContain("Second");
  });
});
