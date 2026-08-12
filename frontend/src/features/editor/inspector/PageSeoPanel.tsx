import { resolveMetadata, type BuilderPage, type PageSeoSettings, type SiteSeoSettings } from "@websitebuilder/shared";
import { useTranslation } from "react-i18next";

import { selectCurrentPage, useEditorStore } from "@/features/editor/store/editorStore";
import { InspectorGroup, SelectField, TextField, ToggleField } from "./controls";

const TITLE_MAX = 60;
const DESCRIPTION_MAX = 160;

/**
 * Page SEO.
 *
 * The preview is rendered from the same resolver the public renderer uses, so what a designer sees
 * here is what a crawler would receive — and it is labelled as advisory, because appearance in a
 * result page is decided by search engines, not by this product.
 */
export function PageSeoPanel() {
  const { t } = useTranslation("builder");
  const store = useEditorStore();
  const page = useEditorStore(selectCurrentPage);
  const site = useEditorStore((state) => state.history.present.seo);

  if (page === null) return null;

  const patch = (values: Partial<PageSeoSettings>) =>
    store.update((document) => ({
      ...document,
      pages: document.pages.map((candidate) =>
        candidate.id === page.id ? { ...candidate, seo: { ...candidate.seo, ...values } } : candidate,
      ),
    }));

  const resolved = resolveMetadata({
    site: site as SiteSeoSettings,
    page: page.seo,
    fallbackTitle: page.name,
    path: pagePathOf(page),
  });

  return (
    <>
      <InspectorGroup titleKey="seo">
        <TextField
          label={t("seo.pageTitle")}
          value={page.seo.title}
          transactionKey={`seo:${page.id}:title`}
          onChange={(title) => patch({ title })}
        />
        <p className="text-[11px] text-ink-500">
          {t("seo.titleCount", { count: page.seo.title.length, max: TITLE_MAX })}
        </p>

        <TextField
          label={t("seo.pageDescription")}
          value={page.seo.description}
          transactionKey={`seo:${page.id}:description`}
          multiline
          onChange={(description) => patch({ description })}
        />
        <p className="text-[11px] text-ink-500">
          {t("seo.titleCount", { count: page.seo.description.length, max: DESCRIPTION_MAX })}
        </p>

        {/* Rendered from the shared resolver, so it cannot drift from published output. */}
        <div className="rounded-md border border-ink-200 bg-ink-50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{t("seo.preview")}</p>
          <p className="mt-2 truncate text-sm text-accent-800">{resolved.title}</p>
          <p className="truncate text-[11px] text-ink-500">{resolved.canonicalUrl ?? pagePathOf(page)}</p>
          <p className="mt-1 line-clamp-2 text-xs text-ink-600">{resolved.description}</p>
          <p className="mt-2 text-[11px] text-ink-500">{t("seo.previewNote")}</p>
        </div>
      </InspectorGroup>

      <InspectorGroup titleKey="advanced" defaultOpen={false}>
        <TextField
          label={t("seo.canonicalPath")}
          value={page.seo.canonicalPath ?? ""}
          transactionKey={`seo:${page.id}:canonical`}
          onChange={(canonicalPath) => patch({ canonicalPath })}
        />
        <ToggleField
          label={t("seo.robotsIndex")}
          checked={page.seo.robots.index}
          onChange={(index) => patch({ robots: { ...page.seo.robots, index } })}
        />
        <ToggleField
          label={t("seo.robotsFollow")}
          checked={page.seo.robots.follow}
          onChange={(follow) => patch({ robots: { ...page.seo.robots, follow } })}
        />
        <SelectField
          label={t("seo.structuredData")}
          value={page.seo.structuredDataType ?? "WebPage"}
          options={(["WebPage", "AboutPage", "ContactPage", "Article"] as const).map((value) => ({
            value,
            label: t(`seo.pageTypes.${value}`),
          }))}
          onChange={(structuredDataType) => patch({ structuredDataType })}
        />
        <p className="text-[11px] text-ink-500">{t("seo.noRanking")}</p>
      </InspectorGroup>
    </>
  );
}

function pagePathOf(page: BuilderPage): string {
  return page.isHome ? "/" : `/${page.slug}`;
}
