import { SUPPORTED_APP_LOCALES, type SupportedAppLocale } from "@websitebuilder/shared";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { changeLocale } from "@/i18n";
import { isSupportedLocale } from "@/i18n/locale";

/**
 * Compact locale switcher. A native select is keyboard accessible, screen-reader friendly and
 * correct on touch without a single line of interaction code — a custom listbox would be more
 * markup for less reliability.
 */
export function LanguageSelector({ className }: { className?: string }) {
  const { t, i18n } = useTranslation("common");
  const id = useId();
  const current = isSupportedLocale(i18n.language) ? i18n.language : SUPPORTED_APP_LOCALES[0];

  return (
    <div className={className}>
      <label htmlFor={id} className="sr-only">
        {t("language.change")}
      </label>
      <select
        id={id}
        value={current}
        onChange={(event) => {
          void changeLocale(i18n, event.target.value as SupportedAppLocale);
        }}
        className="w-full rounded-md border border-ink-200 bg-white px-2 py-1.5 text-sm text-ink-700
          hover:border-ink-300 focus-visible:border-accent-600"
      >
        {SUPPORTED_APP_LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {t(`language.${locale}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
