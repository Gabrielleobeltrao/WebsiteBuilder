import type { SupportedAppLocale } from "@websitebuilder/shared";
import i18next, { type i18n as I18nInstance } from "i18next";
import { initReactI18next } from "react-i18next";

import { readStoredLocale, resolveLocale, writeStoredLocale } from "./locale";
import { DEFAULT_NAMESPACE, NAMESPACES, resources } from "./resources";

export function createI18n(initialLocale: SupportedAppLocale): I18nInstance {
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    resources,
    lng: initialLocale,
    // No language fallback: a missing key must fail a test, not silently show English to a
    // Portuguese speaker. `saveMissing` stays off so nothing is written at runtime.
    fallbackLng: false,
    ns: [...NAMESPACES],
    defaultNS: DEFAULT_NAMESPACE,
    interpolation: { escapeValue: false },
    returnNull: false,
    react: { useSuspense: false },
  });
  return instance;
}

/** Resolves the startup locale from the browser and applies it to the document. */
export function bootstrapI18n(): I18nInstance {
  const locale = resolveLocale({
    storedLocale: readStoredLocale(globalThis.localStorage),
    browserLanguages: globalThis.navigator?.languages ?? [],
  });
  const instance = createI18n(locale);
  applyDocumentLocale(locale);
  return instance;
}

export function applyDocumentLocale(locale: SupportedAppLocale): void {
  globalThis.document?.documentElement?.setAttribute("lang", locale);
}

export async function changeLocale(instance: I18nInstance, locale: SupportedAppLocale): Promise<void> {
  await instance.changeLanguage(locale);
  writeStoredLocale(globalThis.localStorage, locale);
  applyDocumentLocale(locale);
}
