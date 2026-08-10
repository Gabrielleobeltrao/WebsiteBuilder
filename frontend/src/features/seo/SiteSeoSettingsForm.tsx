import { siteSeoSettingsSchema, type SiteSeoSettings } from "@websitebuilder/shared";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Site-wide SEO defaults.
 *
 * Every field here is inherited only by pages that do not override it. Changing a default therefore
 * never erases a page's own value — the two live in separate places and the shared resolver decides
 * which one applies.
 */
export function SiteSeoSettingsForm({
  value,
  onSave,
}: {
  value: SiteSeoSettings;
  onSave: (settings: SiteSeoSettings) => Promise<void>;
}) {
  const { t } = useTranslation(["dashboard", "builder"]);
  const [draft, setDraft] = useState<SiteSeoSettings>(value);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "invalid">("idle");
  const formId = useId();

  const patch = (values: Partial<SiteSeoSettings>) => {
    setDraft((current) => ({ ...current, ...values }));
    setStatus("idle");
  };

  const save = async () => {
    const parsed = siteSeoSettingsSchema.safeParse(draft);
    if (!parsed.success) {
      setStatus("invalid");
      return;
    }
    setStatus("saving");
    await onSave(parsed.data);
    setStatus("saved");
  };

  const field = (key: string) => `${formId}-${key}`;
  const inputClass = "mt-1 w-full rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900";

  return (
    <section aria-labelledby={`${formId}-heading`} className="rounded-xl border border-ink-200 bg-white p-6">
      <h2 id={`${formId}-heading`} className="font-display text-lg font-semibold text-ink-900">
        {t("builder:seo.title")}
      </h2>

      <div className="mt-5 space-y-4">
        <div>
          <label htmlFor={field("siteName")} className="block text-sm font-medium text-ink-700">
            {t("dashboard:seo.siteName")}
          </label>
          <input
            id={field("siteName")}
            value={draft.siteName}
            onChange={(event) => patch({ siteName: event.target.value })}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor={field("titleTemplate")} className="block text-sm font-medium text-ink-700">
            {t("dashboard:seo.titleTemplate")}
          </label>
          <input
            id={field("titleTemplate")}
            value={draft.titleTemplate}
            onChange={(event) => patch({ titleTemplate: event.target.value })}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-ink-500">{t("dashboard:seo.titleTemplateHint")}</p>
        </div>

        <div>
          <label htmlFor={field("defaultDescription")} className="block text-sm font-medium text-ink-700">
            {t("dashboard:seo.defaultDescription")}
          </label>
          <textarea
            id={field("defaultDescription")}
            rows={3}
            value={draft.defaultDescription}
            onChange={(event) => patch({ defaultDescription: event.target.value })}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor={field("canonicalBaseUrl")} className="block text-sm font-medium text-ink-700">
            {t("dashboard:seo.canonicalBaseUrl")}
          </label>
          <input
            id={field("canonicalBaseUrl")}
            type="url"
            value={draft.canonicalBaseUrl ?? ""}
            onChange={(event) => patch({ canonicalBaseUrl: event.target.value || undefined })}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-ink-500">{t("dashboard:seo.canonicalHint")}</p>
        </div>

        <div>
          <label htmlFor={field("locale")} className="block text-sm font-medium text-ink-700">
            {t("dashboard:seo.locale")}
          </label>
          <input
            id={field("locale")}
            value={draft.locale}
            onChange={(event) => patch({ locale: event.target.value })}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-ink-500">{t("dashboard:seo.localeHint")}</p>
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-ink-700">{t("dashboard:seo.defaultRobots")}</legend>
          <div className="mt-2 space-y-2">
            <label className="flex items-center gap-2 text-sm text-ink-800">
              <input
                type="checkbox"
                checked={draft.defaultRobots.index}
                onChange={(event) => patch({ defaultRobots: { ...draft.defaultRobots, index: event.target.checked } })}
                className="size-4"
              />
              {t("builder:seo.robotsIndex")}
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-800">
              <input
                type="checkbox"
                checked={draft.defaultRobots.follow}
                onChange={(event) => patch({ defaultRobots: { ...draft.defaultRobots, follow: event.target.checked } })}
                className="size-4"
              />
              {t("builder:seo.robotsFollow")}
            </label>
          </div>
        </fieldset>
      </div>

      {status === "invalid" && (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {t("dashboard:seo.invalid")}
        </p>
      )}
      {status === "saved" && (
        <p role="status" className="mt-4 text-sm text-accent-800">
          {t("dashboard:seo.saved")}
        </p>
      )}

      <button
        type="button"
        onClick={() => void save()}
        disabled={status === "saving"}
        className="mt-6 rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700
          disabled:opacity-50"
      >
        {status === "saving" ? t("dashboard:seo.saving") : t("dashboard:seo.save")}
      </button>

      <p className="mt-4 text-xs text-ink-500">{t("builder:seo.noRanking")}</p>
    </section>
  );
}
