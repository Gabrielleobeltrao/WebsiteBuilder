import type { CmsField, CmsItemStatus, CmsValidationError } from "@websitebuilder/shared";
import { useTranslation } from "react-i18next";

/**
 * The form for one item, generated from the collection's fields.
 *
 * Every input is keyed by the field's immutable id, so the values this produces stay valid through
 * any number of label changes. A field the schema no longer declares simply has no input; its
 * stored value is untouched and returns if the field does.
 */
export type ItemDraft = {
  slug: string;
  status: CmsItemStatus;
  values: Record<string, unknown>;
};

export function ItemEditor({
  fields,
  draft,
  errors,
  onChange,
  disabled = false,
}: {
  fields: readonly CmsField[];
  draft: ItemDraft;
  errors: readonly CmsValidationError[];
  onChange: (draft: ItemDraft) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("cms");

  const errorFor = (fieldId: string) => errors.find((error) => error.fieldId === fieldId);
  const setValue = (fieldId: string, value: unknown) =>
    onChange({ ...draft, values: { ...draft.values, [fieldId]: value } });

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="block text-sm font-medium text-ink-800">{t("items.slug")}</span>
        <input
          value={draft.slug}
          disabled={disabled}
          onChange={(event) => onChange({ ...draft, slug: event.target.value })}
          className="mt-1 w-full rounded-lg px-3 py-2 font-mono text-sm ring-1 ring-ink-300"
        />
      </label>

      {fields.map((field) => {
        const error = errorFor(field.id);
        const value = draft.values[field.id];

        return (
          <label key={field.id} className="block">
            <span className="block text-sm font-medium text-ink-800">
              {field.label}
              {field.required && <span aria-hidden> *</span>}
            </span>

            <FieldInput
              field={field}
              value={value}
              disabled={disabled}
              invalid={error !== undefined}
              onChange={(next) => setValue(field.id, next)}
            />

            {field.helpText !== undefined && <span className="mt-1 block text-xs text-ink-600">{field.helpText}</span>}

            {error !== undefined && (
              <span role="alert" className="mt-1 block text-xs text-red-700">
                {error.code === "required" ? t("items.requiredField") : t("items.wrongType")}
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}

function FieldInput({
  field,
  value,
  disabled,
  invalid,
  onChange,
}: {
  field: CmsField;
  value: unknown;
  disabled: boolean;
  invalid: boolean;
  onChange: (value: unknown) => void;
}) {
  const ring = invalid ? "ring-red-400" : "ring-ink-300";
  const className = `mt-1 w-full rounded-lg px-3 py-2 text-sm ring-1 ${ring}`;

  if (field.type === "boolean") {
    return (
      <input
        type="checkbox"
        checked={value === true}
        disabled={disabled}
        aria-invalid={invalid}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1"
      />
    );
  }

  if (field.type === "number") {
    return (
      <input
        type="number"
        // Empty stays empty rather than becoming 0: a required-but-missing number must fail
        // validation, not silently save a value nobody entered.
        value={typeof value === "number" ? String(value) : ""}
        disabled={disabled}
        aria-invalid={invalid}
        onChange={(event) => {
          const parsed = Number.parseFloat(event.target.value);
          onChange(event.target.value === "" || Number.isNaN(parsed) ? undefined : parsed);
        }}
        className={className}
      />
    );
  }

  if (field.type === "longText" || field.type === "richText") {
    return (
      <textarea
        rows={4}
        value={typeof value === "string" ? value : ""}
        disabled={disabled}
        aria-invalid={invalid}
        onChange={(event) => onChange(event.target.value)}
        className={className}
      />
    );
  }

  return (
    <input
      type={field.type === "date" ? "date" : "text"}
      value={typeof value === "string" ? value : ""}
      disabled={disabled}
      aria-invalid={invalid}
      onChange={(event) => onChange(event.target.value)}
      className={className}
    />
  );
}
