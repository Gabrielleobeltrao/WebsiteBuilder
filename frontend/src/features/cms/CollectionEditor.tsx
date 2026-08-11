import { CMS_FIELD_TYPES, createId, normalizeCollectionSlug, type CmsField, type CmsFieldType } from "@websitebuilder/shared";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * The schema editor for one collection.
 *
 * Field ids are generated once and never change. Everything stored on an item is keyed by that id,
 * so renaming a label — which people do constantly — cannot touch a single value. Removing a field
 * removes it from this form only; the values stay until an explicit cleanup, because an accidental
 * removal must be recoverable.
 */
export type CollectionDraft = {
  name: string;
  slug: string;
  fields: CmsField[];
  hasDetailRoute: boolean;
};

export function CollectionEditor({
  draft,
  onChange,
  disabled = false,
}: {
  draft: CollectionDraft;
  onChange: (draft: CollectionDraft) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("cms");
  const slugId = useId();
  const detailRouteId = useId();
  const [slugTouched, setSlugTouched] = useState(draft.slug !== "");

  const patch = (values: Partial<CollectionDraft>) => onChange({ ...draft, ...values });

  const setName = (name: string) => {
    // The address follows the name until someone edits it directly, at which point it stops moving
    // on its own — a public path that changes as you keep typing is a broken link waiting to happen.
    patch(slugTouched ? { name } : { name, slug: normalizeCollectionSlug(name) });
  };

  const addField = () => {
    patch({
      fields: [
        ...draft.fields,
        { id: createId(), key: `field${draft.fields.length + 1}`, label: "", type: "shortText", required: false },
      ],
    });
  };

  const updateField = (index: number, values: Partial<CmsField>) => {
    patch({
      fields: draft.fields.map((field, position) =>
        position === index ? ({ ...field, ...values } as CmsField) : field,
      ),
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="block text-sm font-medium text-ink-800">{t("collections.name")}</span>
          <input
            value={draft.name}
            disabled={disabled}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded-lg px-3 py-2 text-sm ring-1 ring-ink-300"
          />
        </label>

        <div>
          {/* The hint is described, not labelled: folding it into the label would make the field's
              accessible name the whole sentence. */}
          <label htmlFor={slugId} className="block text-sm font-medium text-ink-800">
            {t("collections.slug")}
          </label>
          <input
            id={slugId}
            aria-describedby={`${slugId}-hint`}
            value={draft.slug}
            disabled={disabled}
            onChange={(event) => {
              setSlugTouched(true);
              patch({ slug: event.target.value });
            }}
            onBlur={(event) => patch({ slug: normalizeCollectionSlug(event.target.value) })}
            className="mt-1 w-full rounded-lg px-3 py-2 font-mono text-sm ring-1 ring-ink-300"
          />
          <span id={`${slugId}-hint`} className="mt-1 block text-xs text-ink-600">
            {t("collections.slugHint", { slug: normalizeCollectionSlug(draft.slug || draft.name) || "…" })}
          </span>
        </div>
      </div>

      <div className="flex items-start gap-2">
        <input
          id={detailRouteId}
          type="checkbox"
          checked={draft.hasDetailRoute}
          disabled={disabled}
          aria-describedby={`${detailRouteId}-hint`}
          onChange={(event) => patch({ hasDetailRoute: event.target.checked })}
          className="mt-0.5"
        />
        <span>
          <label htmlFor={detailRouteId} className="block text-sm text-ink-800">
            {t("collections.hasDetailRoute")}
          </label>
          <span id={`${detailRouteId}-hint`} className="block text-xs text-ink-600">
            {t("collections.hasDetailRouteHint")}
          </span>
        </span>
      </div>

      <section aria-labelledby="fields-heading">
        <div className="flex items-center justify-between">
          <h3 id="fields-heading" className="text-sm font-semibold text-ink-900">
            {t("fields.title")}
          </h3>
          <button
            type="button"
            onClick={addField}
            disabled={disabled}
            className="rounded-lg px-3 py-1.5 text-sm text-ink-800 ring-1 ring-ink-300 disabled:opacity-50"
          >
            {t("fields.add")}
          </button>
        </div>

        {draft.fields.length === 0 ? (
          <p className="mt-2 text-sm text-ink-600">{t("fields.empty")}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {draft.fields.map((field, index) => (
              <li key={field.id} className="grid gap-2 rounded-lg bg-white p-3 ring-1 ring-ink-200 sm:grid-cols-[1fr_auto_auto_auto]">
                <label className="block">
                  <span className="sr-only">{t("fields.label")}</span>
                  <input
                    value={field.label}
                    aria-label={`${t("fields.label")} ${index + 1}`}
                    disabled={disabled}
                    onChange={(event) => updateField(index, { label: event.target.value, key: event.target.value })}
                    className="w-full rounded-md px-2 py-1.5 text-sm ring-1 ring-ink-300"
                  />
                </label>

                <label className="block">
                  <span className="sr-only">{t("fields.type")}</span>
                  <select
                    value={field.type}
                    aria-label={`${t("fields.type")} ${index + 1}`}
                    disabled={disabled}
                    onChange={(event) => updateField(index, { type: event.target.value as CmsFieldType })}
                    className="rounded-md px-2 py-1.5 text-sm ring-1 ring-ink-300"
                  >
                    {CMS_FIELD_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(`fields.types.${type}` as "fields.types.shortText")}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex items-center gap-1.5 text-xs text-ink-700">
                  <input
                    type="checkbox"
                    checked={field.required}
                    aria-label={`${t("fields.required")} ${index + 1}`}
                    disabled={disabled}
                    onChange={(event) => updateField(index, { required: event.target.checked })}
                  />
                  {t("fields.required")}
                </label>

                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => patch({ fields: draft.fields.filter((_, position) => position !== index) })}
                  className="rounded-md px-2 py-1.5 text-xs text-red-700 ring-1 ring-red-200 disabled:opacity-50"
                >
                  {t("fields.remove")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
