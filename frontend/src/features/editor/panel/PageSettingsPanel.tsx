import { useTranslation } from "react-i18next";

import { selectCurrentPage, useEditorStore } from "@/features/editor/store/editorStore";

/** Page identity and address. SEO fields join this panel in Phase 12. */
export function PageSettingsPanel() {
  const { t } = useTranslation("builder");
  const page = useEditorStore(selectCurrentPage);
  const store = useEditorStore();

  if (page === null) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-500">{t("panel.pageSettings")}</h2>

      <label className="block text-xs font-medium text-ink-700">
        {t("pages.nameLabel")}
        <input
          value={page.name}
          onFocus={() => store.beginTransaction(`page-name:${page.id}`)}
          onBlur={() => store.endTransaction()}
          onChange={(event) => store.renamePage(page.id, event.target.value)}
          className="mt-1 w-full rounded-md border border-ink-200 px-2 py-1.5 text-sm text-ink-900"
        />
      </label>

      <label className="block text-xs font-medium text-ink-700">
        {t("pages.address")}
        <input
          value={page.isHome ? "/" : page.slug}
          disabled={page.isHome}
          onFocus={() => store.beginTransaction(`page-slug:${page.id}`)}
          onBlur={() => store.endTransaction()}
          onChange={(event) => store.setPageSlug(page.id, event.target.value)}
          className="mt-1 w-full rounded-md border border-ink-200 px-2 py-1.5 text-sm text-ink-900
            disabled:bg-ink-50 disabled:text-ink-500"
        />
      </label>
    </div>
  );
}
