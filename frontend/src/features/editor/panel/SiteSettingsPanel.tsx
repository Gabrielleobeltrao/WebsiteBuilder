import { SUPPORTED_APP_LOCALES, type SiteFeatureKey, type SiteSeoSettings } from "@websitebuilder/shared";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { InspectorGroup, SelectField, TextField, ToggleField } from "@/features/editor/inspector/controls";
import { useEditorStore } from "@/features/editor/store/editorStore";

/**
 * What belongs to the whole site rather than to one page: its name, the SEO defaults every page
 * inherits, and the way out to the flows that live outside the builder.
 *
 * Feature configuration follows the existing lifecycle rule — a link to the blog appears once the
 * site actually has one. Offering every optional feature to every site is how a settings screen
 * becomes a catalogue of things the owner has to rule out.
 */

/** Optional features whose configuration lives on its own route. */
const FEATURE_ROUTES: Partial<Record<SiteFeatureKey, string>> = {
  blog: "blog",
  cms: "cms",
};

export function SiteSettingsPanel({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  const { t } = useTranslation("builder");
  const store = useEditorStore();
  const document = useEditorStore((state) => state.history.present);
  const seo = document.seo as SiteSeoSettings;

  const patchSeo = (values: Partial<SiteSeoSettings>) =>
    store.update((current) => ({ ...current, seo: { ...current.seo, ...values } }));

  const configurable = document.featureStates.filter(
    (state) => state.lifecycle !== "unused" && FEATURE_ROUTES[state.feature] !== undefined,
  );

  return (
    <>
      <InspectorGroup titleKey="content">
        <TextField
          label={t("siteSettings.name")}
          value={document.name}
          transactionKey="site:name"
          onChange={(name) => store.update((current) => ({ ...current, name }))}
        />
        <TextField
          label={t("siteSettings.seoSiteName")}
          value={seo.siteName}
          transactionKey="site:seoName"
          onChange={(siteName) => patchSeo({ siteName })}
        />
        <TextField
          label={t("siteSettings.titleTemplate")}
          value={seo.titleTemplate}
          transactionKey="site:titleTemplate"
          onChange={(titleTemplate) => patchSeo({ titleTemplate })}
        />
        <p className="text-[11px] text-ink-500">{t("siteSettings.titleTemplateHint")}</p>
        <TextField
          label={t("siteSettings.defaultDescription")}
          value={seo.defaultDescription}
          transactionKey="site:defaultDescription"
          multiline
          onChange={(defaultDescription) => patchSeo({ defaultDescription })}
        />
      </InspectorGroup>

      <InspectorGroup titleKey="advanced" defaultOpen={false}>
        <SelectField
          label={t("siteSettings.locale")}
          value={SUPPORTED_APP_LOCALES.includes(seo.locale as (typeof SUPPORTED_APP_LOCALES)[number])
            ? (seo.locale as (typeof SUPPORTED_APP_LOCALES)[number])
            : SUPPORTED_APP_LOCALES[0]}
          options={SUPPORTED_APP_LOCALES.map((locale) => ({ value: locale, label: locale }))}
          onChange={(locale) => patchSeo({ locale })}
        />
        <p className="text-[11px] text-ink-500">{t("siteSettings.localeHint")}</p>
        <ToggleField
          label={t("siteSettings.robotsIndex")}
          checked={seo.defaultRobots.index}
          onChange={(index) => patchSeo({ defaultRobots: { ...seo.defaultRobots, index } })}
        />
        <ToggleField
          label={t("siteSettings.robotsFollow")}
          checked={seo.defaultRobots.follow}
          onChange={(follow) => patchSeo({ defaultRobots: { ...seo.defaultRobots, follow } })}
        />
      </InspectorGroup>

      <nav aria-label={t("siteSettings.elsewhere")} className="space-y-1 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
          {t("siteSettings.elsewhere")}
        </h3>
        <RailLink to={`/app/${workspaceId}/sites/${projectId}/publish`}>{t("siteSettings.publish")}</RailLink>
        <RailLink to={`/app/${workspaceId}/sites/${projectId}/settings/domains`}>
          {t("siteSettings.domains")}
        </RailLink>
        {configurable.map((state) => (
          <RailLink key={state.feature} to={`/app/${workspaceId}/sites/${projectId}/${FEATURE_ROUTES[state.feature]}`}>
            {t(`siteSettings.feature.${state.feature}` as "siteSettings.feature.blog")}
          </RailLink>
        ))}
      </nav>
    </>
  );
}

function RailLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="block rounded-md px-2 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50">
      {children}
    </Link>
  );
}
