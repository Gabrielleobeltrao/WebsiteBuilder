import { z } from "zod";

/**
 * Native forms.
 *
 * `docs/FORMS.md` is the contract these types implement: it states which record owns which part of
 * a form, which definition each surface renders, and what happens on edit, publish, archive and
 * delete. Read it before changing anything here — a change that moves ownership is a change to that
 * document first.
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

/**
 * Names this product reserves inside a submitted form.
 *
 * A field id becomes the `name` attribute of a real input, so the endpoint receives the site's
 * fields and its own control values in one flat body. Reserving one prefix is what keeps a designer
 * from creating a field that shadows the path, the revision or the honeypot — and what lets the
 * endpoint tell them apart without a second envelope that a plain HTML form could not produce.
 */
export const FORM_CONTROL_PREFIX = "__wb_";
export const FORM_CONTROL_FIELDS = {
  path: `${FORM_CONTROL_PREFIX}path`,
  revision: `${FORM_CONTROL_PREFIX}revision`,
  /** Left empty by a person and filled in by anything that fills every input it finds. */
  honeypot: `${FORM_CONTROL_PREFIX}company`,
} as const;

/** Query parameters a no-JavaScript submission is sent back with, so the page can say what happened. */
export const FORM_RESULT_PARAMS = { ok: "wb_form_ok", error: "wb_form_error" } as const;

/** The largest body the public endpoint reads before refusing it unread. */
export const FORM_SUBMISSION_MAX_BYTES = 32_000;

/**
 * A field id is an HTML `name`, so it is restricted to what is safe to be one.
 *
 * Free text was accepted here, which meant a stored definition could name a field anything at all
 * and the published markup would carry it verbatim.
 */
export const formFieldIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, "A field id starts with a letter and holds letters, digits, - and _")
  .refine((id) => !id.startsWith(FORM_CONTROL_PREFIX), "That prefix is reserved");

export const formFieldSchema = z
  .object({
    id: formFieldIdSchema,
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

export const formSuccessBehaviorSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message"), message: z.string().min(1).max(500) }).strict(),
  z.object({ type: z.literal("internalRedirect"), pageId: z.string().min(1) }).strict(),
]);

export type FormSuccessBehavior = z.infer<typeof formSuccessBehaviorSchema>;

export const formDefinitionInputSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    fields: z.array(formFieldSchema).max(40),
    submitLabel: z.string().min(1).max(80),
    successBehavior: formSuccessBehaviorSchema,
    /**
     * What the form says when it could not be sent.
     *
     * On the definition rather than on the block, with everything else the form says: two
     * placements of one form apologising differently is a bug rather than a design choice. Optional
     * because a definition written before this existed has none, and the renderer has a default.
     */
    errorMessage: z.string().min(1).max(500).optional(),
    notificationRecipients: z.array(z.string().email()).max(10),
    retentionDays: z.number().int().min(1).max(3650).optional(),
  })
  .strict();

export type FormDefinitionInput = z.infer<typeof formDefinitionInputSchema>;

/**
 * An update carries the revision it was made against.
 *
 * Without it, two tabs editing one form is last-write-wins with no way to notice: the second save
 * silently discards fields the first one added. This is the same contract project documents use.
 */
export const formDefinitionUpdateSchema = formDefinitionInputSchema.extend({
  expectedRevision: z.number().int().min(1),
});

export type FormDefinitionUpdate = z.infer<typeof formDefinitionUpdateSchema>;

/**
 * A form as a published version carries it.
 *
 * Frozen at publish time and never migrated. A visitor filling in a form is answering *this*
 * revision's questions, and the endpoint validates against the same copy they were shown rather
 * than against a definition that may have been rewritten since.
 */
export const publishedFormSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().max(160),
    revision: z.number().int().min(1),
    fields: z.array(formFieldSchema).max(40),
    submitLabel: z.string().min(1).max(80),
    successBehavior: formSuccessBehaviorSchema,
    errorMessage: z.string().min(1).max(500).optional(),
    status: z.enum(FORM_STATUSES),
  })
  .strict();

export type PublishedForm = z.infer<typeof publishedFormSchema>;

/**
 * The part of a field a submission keeps for itself.
 *
 * Enough to read the answer back after the definition has moved on: the label that was asked, and
 * the options that were offered. Without it, renaming a field turns every past answer into a value
 * beside a question nobody asked.
 */
export const submissionFieldSnapshotSchema = z
  .object({
    id: formFieldIdSchema,
    type: z.enum(FORM_FIELD_TYPES),
    label: z.string().min(1).max(120),
    options: z.array(z.string().min(1).max(120)).max(50).optional(),
  })
  .strict();

export type SubmissionFieldSnapshot = z.infer<typeof submissionFieldSnapshotSchema>;

export function snapshotFields(fields: readonly FormField[]): SubmissionFieldSnapshot[] {
  return fields.map((field) => ({
    id: field.id,
    type: field.type,
    label: field.label,
    ...(field.options === undefined ? {} : { options: [...field.options] }),
  }));
}

/**
 * What the public endpoint accepts, after the body has been flattened to strings.
 *
 * There is no workspace, project or page in here, and that is the point: a field that does not
 * exist cannot be spoofed. Everything about *where* a submission came from is derived on the server
 * from the hostname it arrived on and the published route manifest.
 */
export const formSubmissionRequestSchema = z
  .object({
    /** The path the visitor was on. Believed only if it is a published route of this site. */
    path: z.string().max(2048).optional(),
    /** Which published revision of the form was filled in. Believed only if that revision exists. */
    revision: z.number().int().min(1).optional(),
    /** Values keyed by field id. Anything the definition does not declare is discarded, not stored. */
    values: z.record(z.string().max(64), z.unknown()),
  })
  .strict();

export type FormSubmissionRequest = z.infer<typeof formSubmissionRequestSchema>;

/** What a submission attempt returns. Field-level detail only where the form itself asked wrongly. */
export type FormSubmissionResult =
  | { status: "accepted" }
  | { status: "invalid"; errors: ValidationError[] }
  | { status: "rejected" };

/**
 * How a placement presents the form it points at.
 *
 * Everything here is about *this page*: the same definition can be a full-width sign-up on the home
 * page and a compact box in a sidebar, and neither placement can change what the form asks or what
 * a submission is validated against.
 *
 * The presets are arrangements rather than widths. A width belongs to the element's own responsive
 * layout, which every other block already uses, and duplicating it here would give a form two
 * answers to the same question.
 */
export const FORM_PRESETS = ["stacked", "twoColumn", "compact"] as const;
export type FormPreset = (typeof FORM_PRESETS)[number];

export const formPresentationSchema = z
  .object({
    preset: z.enum(FORM_PRESETS),
    /** Where the form sits inside the space the element occupies. */
    alignment: z.enum(["start", "center", "end"]),
    /** Space between one field and the next. */
    fieldGap: z.number().int().min(0).max(64),
    padding: z.number().int().min(0).max(96),
    /**
     * Fields that take the whole row in `twoColumn`.
     *
     * A message box beside a telephone number reads as two unrelated things; long answers want the
     * width. Keyed by field id, so a field the definition no longer has is simply not found.
     */
    fullWidthFieldIds: z.array(formFieldIdSchema).max(40),
    backgroundColor: z.string().max(40),
    textColor: z.string().max(40),
    /** The submit control and the focus ring: one colour, so a form reads as one thing. */
    accentColor: z.string().max(40),
    borderColor: z.string().max(40),
    borderWidth: z.number().int().min(0).max(8),
    borderRadius: z.number().int().min(0).max(48),
  })
  .strict();

export type FormPresentation = z.infer<typeof formPresentationSchema>;

export const DEFAULT_FORM_PRESENTATION: FormPresentation = {
  preset: "stacked",
  alignment: "start",
  fieldGap: 16,
  padding: 0,
  fullWidthFieldIds: [],
  backgroundColor: "transparent",
  textColor: "#111827",
  accentColor: "#2563eb",
  borderColor: "#d1d5db",
  borderWidth: 1,
  borderRadius: 8,
};

/**
 * Copy a version-1 form block carried before the definition owned it.
 *
 * Kept on the element by the migration and never rendered. The builder offers it as the starting
 * point when a form is created from that block, and clears it once the block is bound — so nothing
 * a designer wrote is discarded, and nothing that is no longer the source of truth is displayed.
 */
export const legacyFormCopySchema = z
  .object({
    submitLabel: z.string().max(80),
    successMessage: z.string().max(500),
    errorMessage: z.string().max(500),
    consentText: z.string().max(500),
    consentRequired: z.boolean(),
  })
  .strict();

export type LegacyFormCopy = z.infer<typeof legacyFormCopySchema>;

/**
 * Starting points, not types.
 *
 * A template produces an ordinary definition and is then forgotten, exactly like a page pattern:
 * the record stores no memory of where its fields came from, so nothing here can constrain what a
 * form becomes afterwards.
 *
 * The copy is resolved by the caller from its own locale at creation time and then belongs to the
 * author — a translated label that changed under them when they switched languages would be a
 * label they never agreed to.
 */
/**
 * A stored definition, as every layer sees it.
 *
 * Declared here rather than in the database module because it is an API contract: the Forms Center
 * reads exactly this, and two hand-kept copies of one shape is how a field ends up meaning
 * different things on the two sides of a request.
 */
export type FormRecord = FormDefinitionInput & {
  id: string;
  workspaceId: string;
  projectId: string;
  status: FormStatus;
  archived: boolean;
  /** The content revision: what the form asks and says. Archiving does not move it. */
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export const SUBMISSION_STATUSES = ["new", "read", "archived", "spam"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/** Where a submission came from, as the server worked it out. Never from the body. */
export type SubmissionSource = { pageId?: string; path?: string; host?: string; utm?: Record<string, string> };

export type FormSubmissionRecord = {
  id: string;
  workspaceId: string;
  projectId: string;
  formId: string;
  /** The revision of the definition the visitor actually answered. */
  formRevision: number;
  /** The questions as they were asked, so the answers stay readable after the form moves on. */
  fields: SubmissionFieldSnapshot[];
  values: SubmissionValues;
  source?: SubmissionSource;
  status: SubmissionStatus;
  createdAt: string;
};

export type SubmissionCounts = Record<SubmissionStatus, number> & { total: number };

export type SubmissionPage = {
  items: FormSubmissionRecord[];
  total: number;
  page: number;
  perPage: number;
  counts: SubmissionCounts;
};

export const FORM_TEMPLATE_IDS = ["blank", "contact", "lead", "newsletter"] as const;
export type FormTemplateId = (typeof FORM_TEMPLATE_IDS)[number];

const TEMPLATE_FIELDS: Record<FormTemplateId, ReadonlyArray<{ id: string; type: FormFieldType; required: boolean }>> = {
  blank: [],
  contact: [
    { id: "name", type: "shortText", required: true },
    { id: "email", type: "email", required: true },
    { id: "message", type: "longText", required: true },
  ],
  lead: [
    { id: "name", type: "shortText", required: true },
    { id: "email", type: "email", required: true },
    { id: "phone", type: "phone", required: false },
    { id: "company", type: "shortText", required: false },
  ],
  // Consent is a field with an answer that is stored, not a flag on a block: "did this person agree"
  // is exactly the kind of question a subscription record has to be able to answer later.
  newsletter: [
    { id: "email", type: "email", required: true },
    { id: "consent", type: "consent", required: true },
  ],
};

export function buildFormTemplate(id: FormTemplateId, copy: (key: string) => string): FormDefinitionInput {
  return {
    name: copy(`templates.${id}.name`),
    fields: TEMPLATE_FIELDS[id].map((field) => ({
      id: field.id,
      type: field.type,
      label: copy(`templates.fields.${field.id}`),
      required: field.required,
    })),
    submitLabel: copy(`templates.${id}.submit`),
    successBehavior: { type: "message", message: copy(`templates.${id}.success`) },
    errorMessage: copy("templates.error"),
    notificationRecipients: [],
  };
}

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
