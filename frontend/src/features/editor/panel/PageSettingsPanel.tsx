import { useTranslation } from "react-i18next";

import { ColorField, InspectorGroup, NumberField } from "@/features/editor/inspector/controls";
import { PageSeoPanel } from "@/features/editor/inspector/PageSeoPanel";
import { selectCurrentPage, useEditorStore } from "@/features/editor/store/editorStore";

/**
 * Everything about the current page in one destination: identity, address, canvas, and SEO.
 *
 * SEO used to be a sixth top-level builder mode. Splitting a page's title across two places meant an
 * author had to already know the product's internal division to find the title their page shows in a
 * search result — so it is a subsection here, with the same fields and the same validation.
 */
export function PageSettingsPanel() {
  const { t } = useTranslation("builder");
  const page = useEditorStore(selectCurrentPage);
  const store = useEditorStore();

  if (page === null) return null;

  const patchCanvas = (values: Partial<typeof page.canvas>) =>
    store.update((document) => ({
      ...document,
      pages: document.pages.map((candidate) =>
        candidate.id === page.id ? { ...candidate, canvas: { ...candidate.canvas, ...values } } : candidate,
      ),
    }));

  return (
    <div className="space-y-1">
      <InspectorGroup titleKey="content">
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
      </InspectorGroup>

      <InspectorGroup titleKey="canvas" defaultOpen={false}>
        <ColorField
          label={t("pageCanvas.background")}
          value={page.canvas.backgroundColor}
          transactionKey={`page-canvas:${page.id}:background`}
          onChange={(backgroundColor) => patchCanvas({ backgroundColor })}
        />
        <NumberField
          label={t("pageCanvas.minHeight")}
          value={page.canvas.minHeight}
          min={1}
          transactionKey={`page-canvas:${page.id}:minHeight`}
          onChange={(minHeight) => patchCanvas({ minHeight: Math.round(minHeight) })}
        />
      </InspectorGroup>

      <PageSeoPanel />
    </div>
  );
}
