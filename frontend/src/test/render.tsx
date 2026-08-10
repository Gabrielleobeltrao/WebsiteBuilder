import type { SupportedAppLocale } from "@websitebuilder/shared";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";

import { createI18n } from "@/i18n";

/**
 * Renders a route tree with a fresh i18n instance per test, so one test switching language cannot
 * leak into the next, and every UI assertion can be run in both locales.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: { locale?: SupportedAppLocale; route?: string } = {},
): RenderResult & { i18n: ReturnType<typeof createI18n> } {
  const i18n = createI18n(options.locale ?? "en-US");
  const result = render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[options.route ?? "/"]}>{ui}</MemoryRouter>
    </I18nextProvider>,
  );
  return { ...result, i18n };
}
