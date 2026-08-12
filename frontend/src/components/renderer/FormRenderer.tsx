import {
  FORM_CONTROL_FIELDS,
  FORM_RESULT_PARAMS,
  type FormField,
  type FormPresentation,
  type PublishedForm,
} from "@websitebuilder/shared";
import type { CSSProperties } from "react";

import { useRendererContext } from "./RendererContext";

/**
 * A form on a page, in all three places a page is rendered.
 *
 * The markup is the same everywhere; only the mode differs. That is what makes the builder honest:
 * what a designer arranges on the canvas is the element a visitor fills in, rather than a
 * placeholder that resembles one.
 *
 * It works with no JavaScript at all. A real `<form method="post">` posting to the site's own
 * origin is the baseline, and the public runtime upgrades it in place with inline errors and a
 * success message that does not reload the page. A form that only works once a script has loaded is
 * a form that silently loses answers on a slow connection.
 */
export type FormRenderMode =
  /** The builder canvas: real fields, none of them operable, so a click selects the block. */
  | "inert"
  /** The draft preview: real validation, and a server that stores nothing. */
  | "preview"
  /** A published page. */
  | "live";

export function FormRenderer({ elementId, formId, presentation }: {
  elementId: string;
  formId: string;
  presentation: FormPresentation;
}) {
  const { resolveForm, formMode = "inert", formAction, formResult, formStrings } = useRendererContext();

  const form = formId === "" ? null : (resolveForm?.(formId) ?? null);
  const strings = formStrings ?? DEFAULT_STRINGS;

  // Three states a designer has to be able to tell apart at a glance, because the fix for each one
  // is different: nothing chosen, chosen but gone, and chosen but closed.
  if (form === null) {
    return (
      <Placeholder presentation={presentation}>
        {formId === "" ? strings.unbound : strings.missing}
      </Placeholder>
    );
  }
  if (form.status === "archived") {
    return <Placeholder presentation={presentation}>{strings.archived}</Placeholder>;
  }

  const submitted = formResult?.formId === form.id ? formResult.state : null;
  const columns = presentation.preset === "twoColumn";

  return (
    <form
      // Not a bare id: two placements of one form on one page would otherwise share element ids.
      id={`${elementId}-form`}
      data-wb-form={form.id}
      method="post"
      {...(formMode === "live" && formAction !== undefined ? { action: formAction(form.id) } : {})}
      // The canvas must not submit anything, and the preview posts through the runtime so nothing
      // is ever written from a draft.
      {...(formMode === "inert" ? { onSubmit: preventSubmit } : {})}
      noValidate={false}
      style={formStyle(presentation)}
    >
      {/* Server-derived on arrival; sent so a no-JavaScript post still says which page it came
          from. Both are verified against the published manifest and are hints, never identity. */}
      <input type="hidden" name={FORM_CONTROL_FIELDS.revision} value={form.revision} />

      {/*
        The honeypot.
        Hidden from people and from assistive technology, skipped by the keyboard, and never
        autofilled. Anything that fills every input it finds fills this one, and the server drops
        the submission without telling it why.
      */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
        <label htmlFor={`${elementId}-${FORM_CONTROL_FIELDS.honeypot}`}>{FORM_CONTROL_FIELDS.honeypot}</label>
        <input
          id={`${elementId}-${FORM_CONTROL_FIELDS.honeypot}`}
          name={FORM_CONTROL_FIELDS.honeypot}
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      {/* One live region for the whole form: a screen reader announces the outcome once, wherever
          focus happens to be. */}
      <div data-wb-form-status role="status" aria-live="polite" style={{ marginBottom: presentation.fieldGap }}>
        {submitted === "ok" && form.successBehavior.type === "message" ? form.successBehavior.message : null}
      </div>

      <div
        data-wb-form-errors
        role="alert"
        hidden={submitted !== "error"}
        style={{ marginBottom: presentation.fieldGap, color: "#b91c1c" }}
      >
        {submitted === "error" ? (form.errorMessage ?? strings.error) : null}
      </div>

      <div style={fieldsStyle(presentation, columns)}>
        {form.fields
          .filter((field) => field.type !== "hidden")
          .map((field) => (
            <Field
              key={field.id}
              field={field}
              elementId={elementId}
              presentation={presentation}
              columns={columns}
              disabled={formMode === "inert"}
            />
          ))}
      </div>

      <button
        type="submit"
        disabled={formMode === "inert"}
        style={{
          marginTop: presentation.fieldGap,
          backgroundColor: presentation.accentColor,
          color: "#ffffff",
          border: 0,
          borderRadius: presentation.borderRadius,
          padding: "10px 18px",
          font: "inherit",
          cursor: formMode === "inert" ? "default" : "pointer",
        }}
      >
        {form.submitLabel}
      </button>
    </form>
  );
}

function preventSubmit(event: { preventDefault: () => void }) {
  event.preventDefault();
}

/** What a block shows before it can show a form. Visible on the canvas, and never published. */
function Placeholder({ presentation, children }: { presentation: FormPresentation; children: string }) {
  return (
    <div
      data-wb-form-placeholder
      style={{
        ...formStyle(presentation),
        border: `1px dashed ${presentation.borderColor}`,
        color: presentation.textColor,
        display: "grid",
        placeItems: "center",
        minHeight: 120,
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}

/**
 * One question.
 *
 * A group of choices is a `fieldset` with a `legend` rather than a heading and some inputs: that is
 * what makes the question audible to somebody who arrives at the third radio button, and it is not
 * something a visual label can substitute for.
 */
function Field({
  field,
  elementId,
  presentation,
  columns,
  disabled,
}: {
  field: FormField;
  elementId: string;
  presentation: FormPresentation;
  columns: boolean;
  disabled: boolean;
}) {
  const id = `${elementId}-${field.id}`;
  const describedBy = field.helpText === undefined ? undefined : `${id}-help`;
  const span = columns && !presentation.fullWidthFieldIds.includes(field.id) ? "span 1" : "1 / -1";

  const help =
    field.helpText === undefined ? null : (
      <p id={describedBy} style={{ margin: "4px 0 0", fontSize: "0.875em", opacity: 0.75 }}>
        {field.helpText}
      </p>
    );

  const control = (props: Record<string, unknown> = {}) => ({
    id,
    name: field.id,
    required: field.required,
    disabled,
    ...(describedBy === undefined ? {} : { "aria-describedby": describedBy }),
    ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
    ...(field.defaultValue === undefined ? {} : { defaultValue: field.defaultValue }),
    ...props,
  });

  const box: CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    boxSizing: "border-box",
    padding: "8px 10px",
    border: `${presentation.borderWidth}px solid ${presentation.borderColor}`,
    borderRadius: presentation.borderRadius,
    font: "inherit",
    color: "inherit",
    background: "transparent",
  };

  if (field.type === "checkbox" || field.type === "consent") {
    return (
      <div style={{ gridColumn: "1 / -1" }}>
        <label htmlFor={id} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <input type="checkbox" {...control({ value: "on" })} />
          <span>
            {field.label}
            {field.required && <RequiredMark />}
          </span>
        </label>
        {help}
      </div>
    );
  }

  if (field.type === "radio") {
    return (
      <fieldset style={{ gridColumn: span, border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <legend style={{ padding: 0 }}>
          {field.label}
          {field.required && <RequiredMark />}
        </legend>
        {help}
        {(field.options ?? []).map((option, index) => (
          <label key={option} htmlFor={`${id}-${index}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              id={`${id}-${index}`}
              type="radio"
              name={field.id}
              value={option}
              required={field.required && index === 0}
              disabled={disabled}
              {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
            />
            <span>{option}</span>
          </label>
        ))}
      </fieldset>
    );
  }

  return (
    <div style={{ gridColumn: span, minWidth: 0 }}>
      <label htmlFor={id} style={{ display: "block", marginBottom: 4 }}>
        {field.label}
        {field.required && <RequiredMark />}
      </label>

      {field.type === "longText" ? (
        <textarea rows={4} {...control({ maxLength: field.maxLength ?? 5000 })} style={box} />
      ) : field.type === "select" ? (
        <select {...control()} style={box}>
          <option value="" />
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"}
          {...control({ maxLength: field.maxLength ?? 500 })}
          style={box}
        />
      )}

      {help}
    </div>
  );
}

/** Marked in text as well as in the attribute: an asterisk alone is a convention, not a statement. */
function RequiredMark() {
  const { formStrings } = useRendererContext();
  return (
    <span aria-hidden="false" style={{ marginLeft: 4 }}>
      <span aria-hidden="true">*</span>
      <span style={SR_ONLY}>{(formStrings ?? DEFAULT_STRINGS).required}</span>
    </span>
  );
}

const SR_ONLY: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

function formStyle(presentation: FormPresentation): CSSProperties {
  return {
    backgroundColor: presentation.backgroundColor,
    color: presentation.textColor,
    padding: presentation.padding,
    borderRadius: presentation.borderRadius,
    // Never wider than what holds it: a form is the block most likely to be given a fixed width on
    // a 1440 canvas and then rendered on a phone.
    width: "100%",
    maxWidth: "100%",
    boxSizing: "border-box",
    marginInline: presentation.alignment === "center" ? "auto" : presentation.alignment === "end" ? "auto 0" : "0 auto",
  };
}

/**
 * How the questions are arranged.
 *
 * Two columns is a *maximum*, not a promise: the track floor collapses the grid to one column when
 * there is no room for two, with no media query and no width the document had to guess. Compact
 * only tightens the gap — an arrangement that hid labels would be an accessibility decision
 * disguised as a style.
 */
function fieldsStyle(presentation: FormPresentation, columns: boolean): CSSProperties {
  const gap = presentation.preset === "compact" ? Math.max(4, Math.round(presentation.fieldGap / 2)) : presentation.fieldGap;

  return columns
    ? { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap }
    : { display: "grid", gridTemplateColumns: "1fr", gap };
}

/**
 * The copy the renderer needs when its host supplies none.
 *
 * English rather than a translation lookup: this module is compiled into the public renderer, which
 * has no i18n runtime, and a published page's language belongs to the site rather than to the
 * platform. A host that knows better passes its own.
 */
export const DEFAULT_STRINGS = {
  unbound: "Choose which form this block shows.",
  missing: "The form this block pointed at no longer exists.",
  archived: "This form is archived and is not accepting answers.",
  error: "Your message could not be sent. Please try again.",
  required: "(required)",
};

export type FormStrings = typeof DEFAULT_STRINGS;

/** The result of a submission a no-JavaScript visitor was sent back with. */
export function readFormResult(search: string): { formId: string; state: "ok" | "error" } | null {
  const params = new URLSearchParams(search);
  const ok = params.get(FORM_RESULT_PARAMS.ok);
  if (ok !== null && ok !== "") return { formId: ok, state: "ok" };

  const error = params.get(FORM_RESULT_PARAMS.error);
  return error !== null && error !== "" ? { formId: error, state: "error" } : null;
}

export type { PublishedForm };
