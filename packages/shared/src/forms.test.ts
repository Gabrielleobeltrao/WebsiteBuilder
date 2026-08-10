import { describe, expect, it } from "vitest";

import {
  escapeCsvCell,
  findSetupIssues,
  formDefinitionInputSchema,
  renderCsv,
  resolveFormStatus,
  validateSubmission,
  type FormDefinitionInput,
  type FormField,
} from "./forms";

const field = (overrides: Partial<FormField> = {}): FormField => ({
  id: "name",
  type: "shortText",
  label: "Your name",
  required: false,
  ...overrides,
});

const definition = (overrides: Partial<FormDefinitionInput> = {}): FormDefinitionInput => ({
  name: "Contact",
  fields: [field()],
  submitLabel: "Send",
  successBehavior: { type: "message", message: "Thanks!" },
  notificationRecipients: [],
  ...overrides,
});

describe("definition schema", () => {
  it("accepts a well-formed definition", () => {
    expect(formDefinitionInputSchema.safeParse(definition()).success).toBe(true);
  });

  it("rejects an unknown field type or an unknown success behaviour", () => {
    expect(formDefinitionInputSchema.safeParse(definition({ fields: [field({ type: "file" as never })] })).success).toBe(
      false,
    );
    expect(
      formDefinitionInputSchema.safeParse(
        definition({ successBehavior: { type: "externalRedirect", url: "https://evil.example" } as never }),
      ).success,
    ).toBe(false);
  });

  it("rejects an invalid notification recipient", () => {
    expect(formDefinitionInputSchema.safeParse(definition({ notificationRecipients: ["nope"] })).success).toBe(false);
  });
});

describe("setup checklist", () => {
  it("is ready when a visitor could actually complete the form", () => {
    expect(findSetupIssues(definition())).toEqual([]);
    expect(resolveFormStatus(definition())).toBe("ready");
  });

  it("is not ready with no visible field", () => {
    expect(resolveFormStatus(definition({ fields: [] }))).toBe("needs_setup");
    expect(resolveFormStatus(definition({ fields: [field({ type: "hidden" })] }))).toBe("needs_setup");
  });

  it("reports a choice field with no options", () => {
    const issues = findSetupIssues(definition({ fields: [field({ id: "topic", type: "select" })] }));
    expect(issues).toContainEqual({ code: "choice-field-without-options", fieldId: "topic" });
  });

  it("reports a duplicate field id, which would make submissions ambiguous", () => {
    const issues = findSetupIssues(definition({ fields: [field(), field()] }));
    expect(issues).toContainEqual({ code: "duplicate-field-id", fieldId: "name" });
  });

  it("reports a redirect whose target page no longer exists", () => {
    const issues = findSetupIssues(definition({ successBehavior: { type: "internalRedirect", pageId: "gone" } }), {
      pageExists: () => false,
    });
    expect(issues).toContainEqual({ code: "redirect-target-missing" });
  });

  it("does not demand anti-spam configuration to be considered ready", () => {
    // Honeypot and rate limiting are backend concerns; requiring them here would put security
    // plumbing in front of the one thing the designer came to do.
    expect(findSetupIssues(definition())).toEqual([]);
  });

  it("reports archived independently of setup completeness", () => {
    expect(resolveFormStatus(definition({ fields: [] }), { archived: true })).toBe("archived");
  });
});

describe("validateSubmission", () => {
  const contact = definition({
    fields: [
      field({ id: "name", required: true }),
      field({ id: "email", type: "email", label: "Email", required: true }),
      field({ id: "topic", type: "select", label: "Topic", options: ["Sales", "Support"] }),
      field({ id: "consent", type: "consent", label: "I agree", required: true }),
    ],
  });

  it("accepts a valid submission and keys it by field id", () => {
    const result = validateSubmission(contact, {
      name: "Ana",
      email: "ana@example.com",
      topic: "Sales",
      consent: true,
    });

    expect(result.errors).toEqual([]);
    expect(result.accepted).toEqual({ name: "Ana", email: "ana@example.com", topic: "Sales", consent: true });
  });

  it("reports every missing required field rather than only the first", () => {
    const result = validateSubmission(contact, {});
    expect(result.errors.map((error) => error.fieldId).sort()).toEqual(["consent", "email", "name"]);
  });

  it("rejects an invalid email and a select value outside its options", () => {
    const result = validateSubmission(contact, {
      name: "Ana",
      email: "not-an-email",
      topic: "Anything",
      consent: true,
    });

    expect(result.errors).toContainEqual({ fieldId: "email", code: "invalid" });
    expect(result.errors).toContainEqual({ fieldId: "topic", code: "not-an-option" });
  });

  it("ignores fields the definition does not declare, so a form is not a write endpoint", () => {
    const result = validateSubmission(contact, {
      name: "Ana",
      email: "ana@example.com",
      consent: true,
      isAdmin: true,
      workspaceId: "workspace-b",
    });

    expect(result.accepted).not.toHaveProperty("isAdmin");
    expect(result.accepted).not.toHaveProperty("workspaceId");
  });

  it("strips control characters that would break a CSV row or a log line", () => {
    const withControls = `Ana${String.fromCharCode(13)}${String.fromCharCode(10)}Bad`;
    const result = validateSubmission(definition({ fields: [field({ id: "name" })] }), { name: withControls });
    expect(result.accepted.name).toBe("AnaBad");
  });

  it("refuses an over-long value instead of truncating it silently", () => {
    const result = validateSubmission(definition({ fields: [field({ id: "name", maxLength: 5 })] }), {
      name: "Far too long",
    });
    expect(result.errors).toContainEqual({ fieldId: "name", code: "too-long" });
    expect(result.accepted).not.toHaveProperty("name");
  });

  it("treats an unchecked required consent as missing", () => {
    const result = validateSubmission(contact, { name: "Ana", email: "ana@example.com", consent: false });
    expect(result.errors).toContainEqual({ fieldId: "consent", code: "required" });
  });
});

describe("CSV export safety", () => {
  it("neutralises every formula-leading character", () => {
    const payloads = ["=1+1", "+1", "-1", "@SUM(A1)", `${String.fromCharCode(9)}=cmd`, `${String.fromCharCode(13)}=cmd`];
    for (const payload of payloads) {
      expect(escapeCsvCell(payload).startsWith(`"'`)).toBe(true);
    }
  });

  it("leaves ordinary text readable", () => {
    expect(escapeCsvCell("Ana Silva")).toBe('"Ana Silva"');
  });

  it("escapes embedded quotes", () => {
    expect(escapeCsvCell('He said "hi"')).toBe('"He said ""hi"""');
  });

  it("renders rows with CRLF separators", () => {
    const csv = renderCsv([
      ["Name", "Email"],
      ["Ana", "ana@example.com"],
    ]);
    expect(csv).toBe(`"Name","Email"${String.fromCharCode(13)}${String.fromCharCode(10)}"Ana","ana@example.com"`);
  });

  it("neutralises a formula smuggled through a submitted value", () => {
    const csv = renderCsv([['=HYPERLINK("http://evil","click")']]);
    expect(csv.includes(`"'=HYPERLINK`)).toBe(true);
  });
});
