import { SUPPORTED_APP_LOCALES, type SupportedAppLocale } from "@websitebuilder/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { preferencesApi } from "@/api/preferences";
import { PageMetadata } from "@/components/common/PageMetadata";
import { changeLocale } from "@/i18n";
import { isSupportedLocale } from "@/i18n/locale";

/**
 * Settings → Language.
 *
 * The interface changes immediately and the preference is persisted afterwards. If persistence
 * fails the user is told plainly that the change is local only, rather than the app pretending it
 * saved or refusing to switch at all.
 */
export function SettingsPage() {
  const { t, i18n } = useTranslation(["auth", "common"]);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  const current = isSupportedLocale(i18n.language) ? i18n.language : SUPPORTED_APP_LOCALES[0];

  const apply = async (locale: SupportedAppLocale) => {
    await changeLocale(i18n, locale);
    try {
      await preferencesApi.save(locale);
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="px-6 py-10 sm:px-10">
      <PageMetadata title={`${t("auth:settings")} — ${t("common:productName")}`} />
      <div className="mx-auto max-w-2xl">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-950">{t("auth:settings")}</h1>

        <section aria-labelledby="language-heading" className="mt-8 rounded-xl border border-ink-200 p-6">
          <h2 id="language-heading" className="font-display text-lg font-semibold text-ink-900">
            {t("auth:language")}
          </h2>

          <fieldset className="mt-4">
            <legend className="sr-only">{t("common:language.change")}</legend>
            <div className="space-y-2">
              {SUPPORTED_APP_LOCALES.map((locale) => (
                <label key={locale} className="flex items-center gap-2 text-sm text-ink-800">
                  <input
                    type="radio"
                    name="locale"
                    value={locale}
                    checked={current === locale}
                    onChange={() => void apply(locale)}
                    className="size-4"
                  />
                  {t(`common:language.${locale}`)}
                </label>
              ))}
            </div>
          </fieldset>

          {status === "saved" && (
            <p role="status" className="mt-4 text-sm text-accent-800">
              {t("auth:languageSaved")}
            </p>
          )}
          {status === "error" && (
            <p role="alert" className="mt-4 text-sm text-red-800">
              {t("auth:languageFailed")}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
