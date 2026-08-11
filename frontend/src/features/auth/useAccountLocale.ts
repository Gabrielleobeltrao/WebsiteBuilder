import type { SupportedAppLocale } from "@websitebuilder/shared";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { preferencesApi } from "@/api/preferences";
import { changeLocale } from "@/i18n";
import { isSupportedLocale, readStoredLocale, resolveLocale } from "@/i18n/locale";

/**
 * Reconciles the interface language once a session exists.
 *
 * Precedence is deliberate and one-directional: a preference already saved on the account wins and
 * is applied. Only when the account has none is the pre-login choice (or the browser locale) seeded
 * and persisted. A later sign-in from a differently configured browser must never silently
 * overwrite a language the user chose.
 *
 * Neither must a slow read. Someone who changes the language while this request is in flight would
 * otherwise watch it revert when the older answer arrives, so a response is discarded if the
 * language moved after it was asked for.
 */
export function useAccountLocale(isAuthenticated: boolean): void {
  const { i18n } = useTranslation();

  useEffect(() => {
    if (!isAuthenticated) return;
    const controller = new AbortController();

    void (async () => {
      // What the interface was showing when this was asked. A change after that point belongs to
      // the user, and a reply about the state before it is stale.
      const languageWhenRequested = i18n.language;

      try {
        const stored = await preferencesApi.load({ signal: controller.signal });
        if (controller.signal.aborted || i18n.language !== languageWhenRequested) return;

        if (isSupportedLocale(stored.locale)) {
          if (stored.locale !== i18n.language) await changeLocale(i18n, stored.locale);
          return;
        }

        const seeded: SupportedAppLocale = resolveLocale({
          storedLocale: readStoredLocale(globalThis.localStorage),
          browserLanguages: globalThis.navigator?.languages ?? [],
        });
        if (i18n.language !== languageWhenRequested) return;
        await preferencesApi.save(seeded);
        await changeLocale(i18n, seeded);
      } catch {
        // A failed preference read must not lock the user out of the product; the locally
        // resolved locale stays in effect.
      }
    })();

    return () => controller.abort();
  }, [isAuthenticated, i18n]);
}
