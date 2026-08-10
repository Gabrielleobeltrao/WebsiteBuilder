import { DEFAULT_APP_LOCALE, SUPPORTED_APP_LOCALES, type SupportedAppLocale } from "@websitebuilder/shared";

export const LOCALE_STORAGE_KEY = "websitebuilder.locale";

export function isSupportedLocale(value: unknown): value is SupportedAppLocale {
  return typeof value === "string" && (SUPPORTED_APP_LOCALES as readonly string[]).includes(value);
}

/**
 * Matches a browser language tag to a supported locale: exact match first, then the primary
 * subtag, so "pt", "pt-PT" and "pt-BR" all land on Portuguese.
 */
export function matchBrowserLocale(languages: readonly string[]): SupportedAppLocale | null {
  for (const language of languages) {
    if (isSupportedLocale(language)) return language;
    const primary = language.split("-")[0]?.toLowerCase();
    const match = SUPPORTED_APP_LOCALES.find((locale) => locale.split("-")[0]?.toLowerCase() === primary);
    if (match) return match;
  }
  return null;
}

export type LocaleSources = {
  /** Preference stored on the authenticated account. Authoritative when present. */
  accountLocale?: string | null;
  /** Explicit choice the visitor made before signing in. */
  storedLocale?: string | null;
  /** navigator.languages or Accept-Language. */
  browserLanguages?: readonly string[];
};

/**
 * Deterministic precedence: the saved account preference, then an explicit local choice, then the
 * browser, then `en-US`. A changed browser language must never override a preference the user set.
 */
export function resolveLocale(sources: LocaleSources): SupportedAppLocale {
  if (isSupportedLocale(sources.accountLocale)) return sources.accountLocale;
  if (isSupportedLocale(sources.storedLocale)) return sources.storedLocale;
  return matchBrowserLocale(sources.browserLanguages ?? []) ?? DEFAULT_APP_LOCALE;
}

export function readStoredLocale(storage: Pick<Storage, "getItem"> | undefined): string | null {
  try {
    return storage?.getItem(LOCALE_STORAGE_KEY) ?? null;
  } catch {
    // Private browsing modes can throw on access; falling back to the browser locale is correct.
    return null;
  }
}

export function writeStoredLocale(storage: Pick<Storage, "setItem"> | undefined, locale: SupportedAppLocale): void {
  try {
    storage?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // A locale that cannot be persisted is a degraded experience, never a broken one.
  }
}
