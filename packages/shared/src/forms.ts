import { z } from "zod";

/**
 * Native forms.
 *
 * Submissions are keyed by stable field IDs, never by label, so renaming "Your name" to "Full name"
 * keeps every past submission readable. Validation is derived from the same definition on the
 * client and the server — the client for feedback, the server as the actual boundary.
 */
export const FORM_FIELD_TYPES = [
  "shortText",
  "longText",
  "email",
  "phone",
  "select",
  "radio",
  "checkbox",
  "consent",
  "hidden",
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export const FORM_STATUSES = ["draft", "needs_setup", "ready", "archived"] as const;
export type FormStatus = (typeof FORM_STATUSES)[number];

export const formFieldSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(FORM_FIELD_TYPES),
    label: z.string().min(1).max(120),
    required: z.boolean(),
    helpText: z.string().max(300).optional(),
    placeholder: z.string().max(120).optional(),
    options: z.array(z.string().min(1).max(120)).max(50).optional(),
    defaultValue: z.string().max(500).optional(),
    maxLength: z.number().int().min(1).max(5000).optional(),
  })
  .strict();

export type FormField = z.infer<typeof formFieldSchema>;

export const formDefinitionInputSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    fields: z.array(formFieldSchema).max(40),
    submitLabel: z.string().min(1).max(80),
    successBehavior: z.discriminatedUnion("type", [
      z.object({ type: z.literal("message"), message: z.string().min(1).max(500) }).strict(),
      z.object({ type: z.literal("internalRedirect"), pageId: z.string().min(1) }).strict(),
    ]),
    notificationRecipients: z.array(z.string().email()).max(10),
    retentionDays: z.number().int().min(1).max(3650).optional(),
  })
  .strict();

export type FormDefinitionInput = z.infer<typeof formDefinitionInputSchema>;

export type SetupIssue =
  | { code: "no-fields" }
  | { code: "field-missing-label"; fieldId: string }
  | { code: "choice-field-without-options"; fieldId: string }
  | { code: "duplicate-field-id"; fieldId: string }
  | { code: "redirect-target-missing" };

/**
 * A form becomes `ready` only when a visitor could actually complete it.
 *
 * Anti-spam defaults are backend concerns and deliberately absent here: making a designer configure
 * a honeypot before their form counts as finished would put security plumbing in front of the one
 * thing they came to do.
 */
export function findSetupIssues(
  definition: FormDefinitionInput,
  options: { pageExists?: (pageId: string) => boolean } = {},
): SetupIssue[] {
  const issues: SetupIssue[] = [];
  const visible = definition.fields.filter((field) => field.type !== "hidden");

  if (visible.length === 0) issues.push({ code: "no-fields" });

  const seen = new Set<string>();
  for (const field of definition.fields) {
    if (seen.has(field.id)) issues.push({ code: "duplicate-field-id", fieldId: field.id });
    seen.add(field.id);

    if (field.label.trim().length === 0) issues.push({ code: "field-missing-label", fieldId: field.id });

    const needsOptions = field.type === "select" || field.type === "radio";
    if (needsOptions && (field.options ?? []).length === 0) {
      issues.push({ code: "choice-field-without-options", fieldId: field.id });
    }
  }

  if (
    definition.successBehavior.type === "internalRedirect" &&
    options.pageExists !== undefined &&
    !options.pageExists(definition.successBehavior.pageId)
  ) {
    issues.push({ code: "redirect-target-missing" });
  }

  return issues;
}

export function resolveFormStatus(
  definition: FormDefinitionInput,
  options: { archived?: boolean; pageExists?: (pageId: string) => boolean } = {},
): FormStatus {
  if (options.archived === true) return "archived";
  return findSetupIssues(definition, options).length === 0 ? "ready" : "needs_setup";
}

export type SubmissionValues = Record<string, string | string[] | boolean>;

export type ValidationError = { fieldId: string; code: "required" | "invalid" | "too-long" | "not-an-option" };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Validates a submission against its definition.
 *
 * Only fields the definition declares are considered. Anything else a client sends is ignored
 * rather than stored, so a form cannot be turned into an arbitrary write endpoint by adding
 * properties to the payload.
 */
export function validateSubmission(
  definition: Pick<FormDefinitionInput, "fields">,
  values: Record<string, unknown>,
): { errors: ValidationError[]; accepted: SubmissionValues } {
  const errors: ValidationError[] = [];
  const accepted: SubmissionValues = {};

  for (const field of definition.fields) {
    const raw = values[field.id];

    if (field.type === "checkbox" || field.type === "consent") {
      const checked = raw === true || raw === "true" || raw === "on";
      if (field.required && !checked) errors.push({ fieldId: field.id, code: "required" });
      accepted[field.id] = checked;
      continue;
    }

    const text = typeof raw === "string" ? raw.trim() : "";
    if (text.length === 0) {
      if (field.required) errors.push({ fieldId: field.id, code: "required" });
      continue;
    }

    const limit = field.maxLength ?? (field.type === "longText" ? 5000 : 500);
    if (text.length > limit) {
      errors.push({ fieldId: field.id, code: "too-long" });
      continue;
    }

    if (field.type === "email" && !EMAIL.test(text)) {
      errors.push({ fieldId: field.id, code: "invalid" });
      continue;
    }
    if (field.type === "phone" && text.replace(/\D/g, "").length < 6) {
      errors.push({ fieldId: field.id, code: "invalid" });
      continue;
    }
    if ((field.type === "select" || field.type === "radio") && !(field.options ?? []).includes(text)) {
      errors.push({ fieldId: field.id, code: "not-an-option" });
      continue;
    }

    // Control characters are stripped: they serve no purpose in a submitted value and they are how
    // a CSV export or a log line gets broken later.
    accepted[field.id] = text.replace(/[\u0000-\u001f\u007f]/g, "");
  }

  return { errors, accepted };
}

/**
 * Neutralises spreadsheet formulas in an exported cell.
 *
 * A value beginning with =, +, -, @, tab or carriage return is executed on open by Excel, Sheets and
 * LibreOffice. Prefixing with a single quote keeps the text readable while stopping execution.
 */
export function escapeCsvCell(value: string): string {
  const dangerous = /^[=+\-@\t\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return `"${dangerous ? `'${escaped}` : escaped}"`;
}

export function renderCsv(rows: ReadonlyArray<readonly string[]>): string {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
}
