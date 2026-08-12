import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { selectCurrentPage, useEditorStore } from "@/features/editor/store/editorStore";

/** Page list with the operations the plan requires, and the guards that keep a site routable. */
export function PagesPanel() {
  const { t } = useTranslation("builder");
  const pages = useEditorStore((state) => state.history.present.pages);
  const currentPage = useEditorStore(selectCurrentPage);
  const store = useEditorStore();

  const [dialog, setDialog] = useState<{ kind: "add" } | { kind: "delete"; pageId: string } | null>(null);
  const [name, setName] = useState("");

  const isLastPage = pages.length <= 1;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            setName("");
            setDialog({ kind: "add" });
          }}
          className="rounded-md bg-accent-600 px-2 py-1 text-xs font-semibold text-white hover:bg-accent-700"
        >
          {t("pages.add")}
        </button>
      </div>

      <ul className="space-y-1">
        {pages.map((page) => {
          const selected = page.id === currentPage?.id;
          return (
            <li key={page.id}>
              <div
                className={[
                  "rounded-md border px-2 py-2",
                  selected ? "border-accent-300 bg-accent-50" : "border-ink-100",
                ].join(" ")}
              >
                <button
                  type="button"
                  onClick={() => store.setCurrentPage(page.id)}
                  aria-current={selected ? "true" : undefined}
                  className="block w-full text-left"
                >
                  <span className="block truncate text-sm font-medium text-ink-900">{page.name}</span>
                  <span className="block text-xs text-ink-500">
                    {page.isHome ? t("pages.home") : `/${page.slug}`}
                  </span>
                </button>

                <div className="mt-2 flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => store.duplicatePage(page.id)}
                    className="rounded border border-ink-200 px-1.5 py-0.5 text-[11px] text-ink-600"
                  >
                    {t("pages.duplicate")}
                  </button>
                  {!page.isHome && (
                    <button
                      type="button"
                      onClick={() => store.setHomePage(page.id)}
                      className="rounded border border-ink-200 px-1.5 py-0.5 text-[11px] text-ink-600"
                    >
                      {t("pages.setHome")}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={isLastPage}
                    title={isLastPage ? t("pages.lastPage") : undefined}
                    onClick={() => setDialog({ kind: "delete", pageId: page.id })}
                    className="rounded border border-ink-200 px-1.5 py-0.5 text-[11px] text-ink-600 disabled:opacity-40"
                  >
                    {t("pages.delete")}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {isLastPage && <p className="mt-3 text-xs text-ink-500">{t("pages.lastPage")}</p>}

      <ConfirmDialog
        open={dialog?.kind === "add"}
        title={t("pages.addTitle")}
        confirmLabel={t("pages.add")}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          const trimmed = name.trim();
          if (trimmed.length === 0) return;
          store.addPage(trimmed);
          setDialog(null);
        }}
      >
        <label className="block text-sm font-medium text-ink-700">
          {t("pages.nameLabel")}
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
          />
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.kind === "delete"}
        destructive
        title={t("pages.deleteTitle")}
        description={t("pages.deleteWarning")}
        confirmLabel={t("pages.delete")}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (dialog?.kind !== "delete") return;
          store.deletePage(dialog.pageId);
          setDialog(null);
        }}
      />
    </div>
  );
}
