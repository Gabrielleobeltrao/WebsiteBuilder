import { createId, validateCmsItem, type CmsField, type CmsValidationError } from "@websitebuilder/shared";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";

import { ApiError } from "@/api/client";
import { cmsApi, type CmsCollection, type CmsItem } from "@/api/cms";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { PageMetadata } from "@/components/common/PageMetadata";
import { CollectionEditor, type CollectionDraft } from "@/features/cms/CollectionEditor";
import { ItemEditor, type ItemDraft } from "@/features/cms/ItemEditor";

/**
 * Site → Content.
 *
 * Business content is managed here without opening the visual builder, which is the point: someone
 * adding a case study should not have to learn a canvas to do it.
 */
type View =
  | { kind: "collections" }
  | { kind: "collection"; collectionId: string }
  | { kind: "item"; collectionId: string; itemId: string | null };

const emptyCollection = (): CollectionDraft => ({ name: "", slug: "", fields: [], hasDetailRoute: true });

export function CmsRoute() {
  const { t } = useTranslation(["cms", "errors", "common"]);
  const { workspaceId = "", projectId = "" } = useParams();

  const [collections, setCollections] = useState<CmsCollection[]>([]);
  const [items, setItems] = useState<CmsItem[]>([]);
  const [view, setView] = useState<View>({ kind: "collections" });
  const [collectionDraft, setCollectionDraft] = useState<CollectionDraft>(emptyCollection());
  const [itemDraft, setItemDraft] = useState<ItemDraft>({ slug: "", status: "draft", values: {} });
  const [itemErrors, setItemErrors] = useState<CmsValidationError[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "published">("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<{ kind: "collection" | "item"; id: string; name: string } | null>(null);

  const loadCollections = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setCollections(await cmsApi.collections(workspaceId, projectId, signal ? { signal } : {}));
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof ApiError ? caught.code : "INTERNAL_ERROR");
      }
    },
    [workspaceId, projectId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadCollections(controller.signal);
    return () => controller.abort();
  }, [loadCollections]);

  const activeCollection =
    view.kind === "collections" ? null : (collections.find((entry) => entry.id === view.collectionId) ?? null);

  const loadItems = useCallback(
    async (collectionId: string) => {
      try {
        const page = await cmsApi.items(workspaceId, projectId, collectionId, {
          ...(statusFilter === "all" ? {} : { status: statusFilter }),
          ...(search === "" ? {} : { search }),
        });
        setItems(page.items);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.code : "INTERNAL_ERROR");
      }
    },
    [workspaceId, projectId, statusFilter, search],
  );

  useEffect(() => {
    if (view.kind === "collection") void loadItems(view.collectionId);
  }, [view, loadItems]);

  const run = async (action: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      after?.();
      await loadCollections();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.code : "INTERNAL_ERROR");
    } finally {
      setBusy(false);
    }
  };

  const saveItem = async () => {
    if (activeCollection === null || view.kind !== "item") return;

    // Validated with the same function the server uses, so the form and the API agree about what is
    // acceptable rather than the browser guessing.
    const { errors } = validateCmsItem({ fields: activeCollection.fields }, itemDraft.values);
    setItemErrors(errors);
    if (errors.length > 0) {
      setError(null);
      setNotice(null);
      return;
    }

    await run(
      () =>
        view.itemId === null
          ? cmsApi.createItem(workspaceId, projectId, activeCollection.id, itemDraft)
          : cmsApi.updateItem(workspaceId, projectId, view.itemId, itemDraft),
      () => {
        setNotice(t("cms:items.saved"));
        setView({ kind: "collection", collectionId: activeCollection.id });
      },
    );
  };

  return (
    <div className="px-6 py-10 sm:px-10">
      <PageMetadata title={`${t("cms:collections.title")} — ${t("common:productName")}`} />

      <div className="mx-auto max-w-4xl space-y-6">
        <header>
          <h1 className="font-display text-2xl font-semibold text-ink-950">{t("cms:collections.title")}</h1>
          <p className="mt-1 text-sm text-ink-600">{t("cms:collections.subtitle")}</p>
        </header>

        {error !== null && (
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">
            {t(`errors:${error}` as "errors:INTERNAL_ERROR")}
          </p>
        )}

        {notice !== null && (
          <p role="status" className="rounded-lg bg-accent-50 px-4 py-3 text-sm text-accent-900 ring-1 ring-accent-200">
            {notice}
          </p>
        )}

        {view.kind === "collections" && (
          <section className="space-y-4">
            {collections.length === 0 ? (
              <div className="rounded-lg bg-white p-6 text-center ring-1 ring-ink-200">
                <p className="text-sm text-ink-800">{t("cms:collections.empty")}</p>
                <p className="mt-1 text-xs text-ink-600">{t("cms:collections.emptyHint")}</p>
              </div>
            ) : (
              <ul className="divide-y divide-ink-200 rounded-lg bg-white ring-1 ring-ink-200">
                {collections.map((collection) => (
                  <li key={collection.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setView({ kind: "collection", collectionId: collection.id })}
                      className="text-left"
                    >
                      <span className="block text-sm font-medium text-ink-900">{collection.name}</span>
                      <span className="block font-mono text-xs text-ink-600">/{collection.slug}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleting({ kind: "collection", id: collection.id, name: collection.name })}
                      className="rounded-lg px-3 py-1.5 text-sm text-red-700 ring-1 ring-red-200"
                    >
                      {t("cms:items.delete")}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <details className="rounded-lg bg-white p-4 ring-1 ring-ink-200">
              <summary className="cursor-pointer text-sm font-medium text-ink-900">
                {t("cms:nav.newCollection")}
              </summary>
              <div className="mt-4 space-y-4">
                <CollectionEditor draft={collectionDraft} onChange={setCollectionDraft} disabled={busy} />
                <button
                  type="button"
                  disabled={busy || collectionDraft.name.trim() === ""}
                  onClick={() =>
                    void run(
                      () => cmsApi.createCollection(workspaceId, projectId, collectionDraft),
                      () => setCollectionDraft(emptyCollection()),
                    )
                  }
                  className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {busy ? t("cms:collections.creating") : t("cms:collections.create")}
                </button>
              </div>
            </details>
          </section>
        )}

        {view.kind === "collection" && activeCollection !== null && (
          <section className="space-y-4">
            <button
              type="button"
              onClick={() => setView({ kind: "collections" })}
              className="text-sm text-accent-700 underline"
            >
              {t("cms:nav.back")}
            </button>

            <h2 className="font-display text-lg font-semibold text-ink-950">{activeCollection.name}</h2>

            <div className="flex flex-wrap items-center gap-2">
              {(["all", "draft", "published"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={statusFilter === option}
                  onClick={() => setStatusFilter(option)}
                  className={[
                    "rounded-md px-3 py-1.5 text-xs font-medium",
                    statusFilter === option ? "bg-ink-900 text-white" : "ring-1 ring-ink-300 text-ink-700",
                  ].join(" ")}
                >
                  {t(`cms:items.${option}` as "cms:items.all")}
                </button>
              ))}

              <input
                value={search}
                aria-label={t("cms:items.searchLabel")}
                placeholder={t("cms:items.search")}
                onChange={(event) => setSearch(event.target.value)}
                className="rounded-md px-3 py-1.5 text-xs ring-1 ring-ink-300"
              />

              <button
                type="button"
                onClick={() => {
                  setItemDraft({ slug: "", status: "draft", values: {} });
                  setItemErrors([]);
                  setView({ kind: "item", collectionId: activeCollection.id, itemId: null });
                }}
                className="ml-auto rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-medium text-white"
              >
                {t("cms:items.new")}
              </button>
            </div>

            {items.length === 0 ? (
              <p className="text-sm text-ink-600">{t("cms:items.empty")}</p>
            ) : (
              <ul className="divide-y divide-ink-200 rounded-lg bg-white ring-1 ring-ink-200">
                {items.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <div>
                      <span className="block font-mono text-sm text-ink-900">{item.slug}</span>
                      <span className="block text-xs text-ink-600">
                        {t(`cms:items.${item.status}` as "cms:items.draft")}
                      </span>
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setItemDraft({ slug: item.slug, status: item.status, values: item.values });
                          setItemErrors([]);
                          setView({ kind: "item", collectionId: activeCollection.id, itemId: item.id });
                        }}
                        className="rounded-lg px-3 py-1.5 text-xs text-ink-800 ring-1 ring-ink-300"
                      >
                        {t("cms:items.edit")}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => cmsApi.duplicateItem(workspaceId, projectId, item.id),
                            () => void loadItems(activeCollection.id),
                          )
                        }
                        className="rounded-lg px-3 py-1.5 text-xs text-ink-800 ring-1 ring-ink-300 disabled:opacity-50"
                      >
                        {t("cms:items.duplicate")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting({ kind: "item", id: item.id, name: item.slug })}
                        className="rounded-lg px-3 py-1.5 text-xs text-red-700 ring-1 ring-red-200"
                      >
                        {t("cms:items.delete")}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {view.kind === "item" && activeCollection !== null && (
          <section className="space-y-4">
            <button
              type="button"
              onClick={() => setView({ kind: "collection", collectionId: activeCollection.id })}
              className="text-sm text-accent-700 underline"
            >
              {t("cms:nav.back")}
            </button>

            <ItemEditor
              fields={activeCollection.fields}
              draft={itemDraft}
              errors={itemErrors}
              onChange={setItemDraft}
              disabled={busy}
            />

            {itemErrors.length > 0 && (
              <p role="alert" className="text-sm text-red-800">
                {t("cms:items.invalid")}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveItem()}
                className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy ? t("cms:items.saving") : t("cms:items.save")}
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setItemDraft({ ...itemDraft, status: itemDraft.status === "published" ? "draft" : "published" })
                }
                className="rounded-lg px-4 py-2 text-sm text-ink-800 ring-1 ring-ink-300 disabled:opacity-50"
              >
                {itemDraft.status === "published" ? t("cms:items.unpublish") : t("cms:items.publish")}
              </button>
            </div>
          </section>
        )}
      </div>

      <ConfirmDialog
        open={deleting !== null}
        title={
          deleting?.kind === "collection"
            ? t("cms:collections.deleteConfirmTitle", { name: deleting.name })
            : t("cms:items.deleteConfirmTitle")
        }
        description={
          deleting?.kind === "collection"
            ? t("cms:collections.deleteConfirmBody")
            : t("cms:items.deleteConfirmBody")
        }
        confirmLabel={
          deleting?.kind === "collection" ? t("cms:collections.deleteConfirm") : t("cms:items.deleteConfirm")
        }
        destructive
        busy={busy}
        onConfirm={() => {
          const target = deleting;
          setDeleting(null);
          if (target === null) return;

          void run(
            () =>
              target.kind === "collection"
                ? cmsApi.deleteCollection(workspaceId, projectId, target.id)
                : cmsApi.deleteItem(workspaceId, projectId, target.id),
            () => {
              if (target.kind === "collection") setView({ kind: "collections" });
              else if (activeCollection !== null) void loadItems(activeCollection.id);
            },
          );
        }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

/** Exported for the field-id guarantee test: ids are generated here and never derived from labels. */
export function newFieldId(): string {
  return createId();
}

export type { CmsField };
