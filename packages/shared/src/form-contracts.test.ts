import { describe, expect, it } from "vitest";

import { migrateElement, storedElementVersion } from "./element-migrations";
import { elementDefinition } from "./element-registry";
import { builderElementSchema, type BuilderElement } from "./elements";
import {
  DEFAULT_FORM_PRESENTATION,
  FORM_CONTROL_FIELDS,
  FORM_CONTROL_PREFIX,
  formDefinitionInputSchema,
  formDefinitionUpdateSchema,
  formFieldIdSchema,
  formPresentationSchema,
  formSubmissionRequestSchema,
  publishedFormSchema,
  snapshotFields,
  type FormDefinitionInput,
} from "./forms";

/**
 * The form model, at its boundaries.
 *
 * Three properties are load-bearing and are asserted rather than assumed: a field id is safe to be
 * an HTML `name`, a public submission cannot name a tenant, and a version-1 block loses nothing on
 * the way to version 2.
 */

const definition = (overrides: Partial<FormDefinitionInput> = {}): FormDefinitionInput => ({
  name: "Contact",
  fields: [{ id: "name", type: "shortText", label: "Your name", required: true }],
  submitLabel: "Send",
  successBehavior: { type: "message", message: "Thank you." },
  notificationRecipients: [],
  ...overrides,
});

describe("a field id", () => {
  it("accepts what an HTML name may safely be", () => {
    for (const id of ["name", "e-mail", "field_2", "A1"]) {
      expect(formFieldIdSchema.safeParse(id).success, id).toBe(true);
    }
  });

  it("refuses what would escape the attribute it becomes", () => {
    for (const id of ["", "a b", "a\"b", "<script>", "a.b", "2fast", "x".repeat(65)]) {
      expect(formFieldIdSchema.safeParse(id).success, id).toBe(false);
    }
  });

  it("refuses the prefix this product reserves for its own controls", () => {
    // A field named __wb_path would arrive in the same flat body as the real one, and the endpoint
    // would have to guess which was which.
    expect(formFieldIdSchema.safeParse(`${FORM_CONTROL_PREFIX}path`).success).toBe(false);
    for (const control of Object.values(FORM_CONTROL_FIELDS)) {
      expect(formFieldIdSchema.safeParse(control).success, control).toBe(false);
    }
  });
});

describe("a definition", () => {
  it("refuses a field the schema does not declare", () => {
    expect(formDefinitionInputSchema.safeParse({ ...definition(), webhookUrl: "https://evil.test" }).success).toBe(false);
  });

  it("bounds what a designer can store", () => {
    expect(formDefinitionInputSchema.safeParse(definition({ name: "x".repeat(161) })).success).toBe(false);
    expect(
      formDefinitionInputSchema.safeParse(
        definition({ fields: Array.from({ length: 41 }, (_, index) => ({ id: `f${index}`, type: "shortText" as const, label: "L", required: false })) }),
      ).success,
    ).toBe(false);
    expect(formDefinitionInputSchema.safeParse(definition({ notificationRecipients: Array(11).fill("a@b.co") })).success).toBe(false);
  });

  it("requires the revision it was edited against on update", () => {
    expect(formDefinitionUpdateSchema.safeParse(definition()).success).toBe(false);
    expect(formDefinitionUpdateSchema.safeParse({ ...definition(), expectedRevision: 3 }).success).toBe(true);
    expect(formDefinitionUpdateSchema.safeParse({ ...definition(), expectedRevision: 0 }).success).toBe(false);
  });
});

describe("a published form", () => {
  it("carries the revision a visitor answered", () => {
    const parsed = publishedFormSchema.safeParse({
      ...definition(),
      id: "f1",
      revision: 4,
      status: "ready",
      notificationRecipients: undefined,
    });

    // Recipients are an operational setting, not something a published page needs — and shipping a
    // customer's notification addresses into public output would be a leak, not a feature.
    expect(parsed.success).toBe(false);

    const { notificationRecipients: _dropped, ...rest } = definition();
    expect(publishedFormSchema.safeParse({ ...rest, id: "f1", revision: 4, status: "ready" }).success).toBe(true);
  });
});

describe("a public submission", () => {
  it("has nowhere to name a tenant", () => {
    const spoofed = {
      values: { name: "A" },
      workspaceId: "someone-else",
      projectId: "someone-else",
      pageId: "p1",
    };

    expect(formSubmissionRequestSchema.safeParse(spoofed).success).toBe(false);
    expect(formSubmissionRequestSchema.safeParse({ values: { name: "A" }, path: "/contact", revision: 2 }).success).toBe(true);
  });
});

describe("a field snapshot", () => {
  it("keeps the question that was asked, and nothing operational", () => {
    const snapshot = snapshotFields([
      { id: "choice", type: "select", label: "Plan", required: true, options: ["A", "B"], helpText: "internal note" },
    ]);

    expect(snapshot).toEqual([{ id: "choice", type: "select", label: "Plan", options: ["A", "B"] }]);
  });
});

describe("a version-1 form block", () => {
  const legacy = (overrides: Record<string, unknown> = {}): BuilderElement =>
    ({
      id: "form-1",
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
      version: 1,
      formId: "abc",
      submitLabel: "Send",
      successMessage: "Thank you. Your message has been sent.",
      errorMessage: "Your message could not be sent. Please try again.",
      consentText: "",
      consentRequired: false,
      ...overrides,
    }) as unknown as BuilderElement;

  it("becomes a version-2 block the document accepts", () => {
    const migrated = migrateElement(legacy());

    expect(storedElementVersion(migrated)).toBe(elementDefinition("form").schemaVersion);
    expect(builderElementSchema.safeParse(migrated).success).toBe(true);
    expect(migrated).toMatchObject({ formId: "abc", presentation: DEFAULT_FORM_PRESENTATION });
  });

  it("keeps copy the designer actually wrote", () => {
    const migrated = migrateElement(
      legacy({ submitLabel: "Fale conosco", consentRequired: true, consentText: "Aceito os termos." }),
    ) as BuilderElement & { legacyCopy?: Record<string, unknown> };

    // Not rendered, and not lost: an element migration cannot reach the collection that owns a
    // definition, so what a person typed is parked where the builder can offer it back.
    expect(migrated.legacyCopy).toMatchObject({
      submitLabel: "Fale conosco",
      consentRequired: true,
      consentText: "Aceito os termos.",
    });
  });

  it("carries nothing forward when nothing was ever changed", () => {
    const migrated = migrateElement(legacy()) as BuilderElement & { legacyCopy?: unknown };
    expect(migrated.legacyCopy).toBeUndefined();
  });

  it("is idempotent", () => {
    const once = migrateElement(legacy({ submitLabel: "Fale conosco" }));
    const twice = migrateElement(once);

    // The second run has nothing to do, and says so by returning the same object.
    expect(twice).toBe(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("refuses the version-1 shape once the block is version 2", () => {
    // The old fields are gone from the schema, so a client that still sends them is refused rather
    // than quietly storing a second, stale copy of what the form says.
    expect(builderElementSchema.safeParse(legacy({ version: 2 })).success).toBe(false);
  });
});

describe("presentation", () => {
  it("is bounded and closed", () => {
    expect(formPresentationSchema.safeParse(DEFAULT_FORM_PRESENTATION).success).toBe(true);
    expect(formPresentationSchema.safeParse({ ...DEFAULT_FORM_PRESENTATION, preset: "masonry" }).success).toBe(false);
    expect(formPresentationSchema.safeParse({ ...DEFAULT_FORM_PRESENTATION, fieldGap: 500 }).success).toBe(false);
    expect(formPresentationSchema.safeParse({ ...DEFAULT_FORM_PRESENTATION, css: "body{}" }).success).toBe(false);
  });
});
