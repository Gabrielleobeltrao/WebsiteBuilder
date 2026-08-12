import { Eye, Redo2, Rocket, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { PageMetadata } from "@/components/common/PageMetadata";
import { EditableCanvas } from "@/features/editor/canvas/EditableCanvas";
import { ElementsPanel } from "@/features/editor/panel/ElementsPanel";
import { LayersPanel } from "@/features/editor/panel/LayersPanel";
import { PageSettingsPanel } from "@/features/editor/panel/PageSettingsPanel";
import { PagesPanel } from "@/features/editor/panel/PagesPanel";
import { SiteSettingsPanel } from "@/features/editor/panel/SiteSettingsPanel";
import { resolvePanelView } from "@/features/editor/panel/panelMachine";
import { RightPanel } from "@/features/editor/panel/RightPanel";
import { DeviceSwitcher } from "@/features/editor/canvas/DeviceSwitcher";
import { SaveStateIndicator } from "@/features/editor/SaveStateIndicator";
import { findElement } from "@/features/editor/store/elements";
import {
  selectCurrentPage,
  selectHasUnsavedChanges,
  selectInsertionTarget,
  useEditorStore,
  type PanelMode,
} from "@/features/editor/store/editorStore";
import { useAuthoringCapability } from "@/features/editor/useAuthoringCapability";
import { useKeyboardShortcuts } from "@/features/editor/useKeyboardShortcuts";
import { canRedo, canUndo } from "@/features/editor/store/history";
import { useRelativeTime } from "@/hooks/useRelativeTime";
import { useUnsavedChangesWarning } from "@/hooks/useUnsavedChangesWarning";

/**
 * Editor layout: application navigation stays on the left (Phase 11 mounts the permanent sidebar),
 * the canvas occupies the centre, and every builder control lives in the fixed right panel. There
 * is deliberately no second builder-specific left sidebar.
 */
export function EditorShell({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  const { t } = useTranslation(["builder", "errors", "common"]);
  const capability = useAuthoringCapability();
  const formatRelative = useRelativeTime();

  const store = useEditorStore();
  const page = useEditorStore(selectCurrentPage);
  const hasUnsaved = useEditorStore(selectHasUnsavedChanges);
  const view = resolvePanelView({
    panelMode: store.ui.panelMode,
    selection: store.ui.selection,
    intent: store.ui.panelIntent,
  });

  useUnsavedChangesWarning(hasUnsaved);
  // Shortcuts are mounted only where authoring is allowed, never in the preview-only shell.
  useKeyboardShortcuts(capability.canAuthor);

  if (store.loadStatus === "loading" || store.loadStatus === "idle") {
    return (
      <p role="status" className="p-10 text-center text-ink-500">
        {t("builder:loading")}
      </p>
    );
  }

  if (store.loadStatus === "error") {
    return (
      <div role="alert" className="p-10 text-center">
        <h1 className="font-display text-lg font-semibold text-ink-900">{t("builder:loadError")}</h1>
        <p className="mt-2 text-sm text-ink-600">
          {t(`errors:${store.loadErrorCode ?? "INTERNAL_ERROR"}` as "errors:INTERNAL_ERROR")}
        </p>
      </div>
    );
  }

  // Mobile and tablet-class access is preview only: no canvas, no inspector, no autosave path.
  if (!capability.canAuthor) {
    return (
      <div className="p-8">
        <PageMetadata title={`${store.history.present.name} — ${t("common:productName")}`} />
        <h1 className="font-display text-xl font-semibold text-ink-950">
          {capability.reason === "narrow" ? t("builder:gate.resizeTitle") : t("builder:gate.title")}
        </h1>
        <p className="mt-2 max-w-md text-sm text-ink-600">
          {capability.reason === "narrow" ? t("builder:gate.resizeDescription") : t("builder:gate.description")}
        </p>
        <p className="mt-4 text-xs text-ink-500">
          {t("builder:gate.savedAt", { when: formatRelative(new Date().toISOString()) })}
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            to={`/preview/${workspaceId}/${projectId}`}
            className="rounded-md border border-ink-200 px-4 py-2 text-sm font-medium text-ink-700"
          >
            {t("builder:gate.previewMobile")}
          </Link>
          <Link
            to={`/preview/${workspaceId}/${projectId}?viewport=desktop`}
            className="rounded-md border border-ink-200 px-4 py-2 text-sm font-medium text-ink-700"
          >
            {t("builder:gate.previewDesktop")}
          </Link>
        </div>
      </div>
    );
  }

  /**
   * Where a click on a library block puts the element, in the author's words.
   *
   * The panel says this before anything is clicked. "It went somewhere" is the complaint that made
   * click insertion feel broken, and it was never about the destination being wrong — it was about
   * the destination being unstated.
   */
  const destinationLabel = (): string => {
    const target = selectInsertionTarget(store);
    if (target === null) return t("builder:elements.newSection");
    if (target.containerId !== undefined) {
      const container = findElement(store.history.present, target.containerId);
      return container?.name || t("builder:elements.container");
    }
    const section = page?.sections.find((candidate) => candidate.id === target.sectionId);
    return section?.name || t("builder:elements.section");
  };

  const renderMode = (mode: PanelMode) => {
    switch (mode) {
      case "pages":
        return <PagesPanel />;
      case "elements":
        return <ElementsPanel onAdd={(type) => store.insertElement(type)} destination={destinationLabel()} />;
      case "layers":
        return <LayersPanel />;
      case "pageSettings":
        return <PageSettingsPanel />;
      case "siteSettings":
        return <SiteSettingsPanel workspaceId={workspaceId} projectId={projectId} />;
    }
  };

  return (
    <div className="flex h-dvh flex-col">
      <PageMetadata title={`${store.history.present.name} — ${t("common:productName")}`} />

      <header className="flex items-center justify-between gap-4 border-b border-ink-100 px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <Link to={`/app/${workspaceId}/sites`} className="text-xs font-medium text-ink-600 underline">
            {t("builder:topBar.backToSites")}
          </Link>
          <h1 className="truncate font-display text-sm font-semibold text-ink-900">{store.history.present.name}</h1>
          <select
            aria-label={t("builder:topBar.currentPage")}
            value={page?.id ?? ""}
            onChange={(event) => store.setCurrentPage(event.target.value)}
            className="max-w-40 truncate rounded-md border border-ink-200 px-2 py-1 text-xs text-ink-700"
          >
            {store.history.present.pages.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3">
          <DeviceSwitcher />
          <SaveStateIndicator
            persistence={store.persistence}
            onRetry={() => void store.save()}
            onResolveConflict={() => void store.load(workspaceId, projectId)}
          />
          <button
            type="button"
            onClick={store.undo}
            disabled={!canUndo(store.history)}
            aria-label={t("builder:topBar.undo")}
            className="rounded-md border border-ink-200 p-1.5 text-ink-700 disabled:opacity-40"
          >
            <Undo2 aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            onClick={store.redo}
            disabled={!canRedo(store.history)}
            aria-label={t("builder:topBar.redo")}
            className="rounded-md border border-ink-200 p-1.5 text-ink-700 disabled:opacity-40"
          >
            <Redo2 aria-hidden className="size-4" />
          </button>
          {/* One preview. Which device it opens in is the device switcher's job, not a second
              button's — two preview buttons was the product asking the same question twice. */}
          <Link
            to={`/preview/${workspaceId}/${projectId}`}
            className="flex items-center gap-1.5 rounded-md border border-ink-200 px-3 py-1.5 text-xs
              font-medium text-ink-700"
          >
            <Eye aria-hidden className="size-3.5" />
            {t("builder:topBar.preview")}
          </Link>
          {/* Manual save stays: autosave can fail, and a person about to close the tab is entitled
              to make the write happen rather than trust a timer they cannot see. */}
          <button
            type="button"
            onClick={() => void store.save()}
            className="rounded-md border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-700"
          >
            {t("builder:topBar.save")}
          </button>
          <Link
            to={`/app/${workspaceId}/sites/${projectId}/publish`}
            className="flex items-center gap-1.5 rounded-md bg-accent-600 px-3 py-1.5 text-xs font-semibold
              text-white hover:bg-accent-700"
          >
            <Rocket aria-hidden className="size-3.5" />
            {t("builder:topBar.publish")}
          </Link>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1">
          <EditableCanvas page={page} />
        </main>

        {/* Fixed width: changing panel modes must never resize or jump the canvas. */}
        <aside aria-label={t("builder:panel.label")} className="w-80 shrink-0 border-l border-ink-100 bg-white">
          <RightPanel
            view={view}
            page={page}
            pages={store.history.present.pages}
            panelMode={store.ui.panelMode}
            onPanelMode={store.setPanelMode}
            onBack={() => store.select(null)}
            renderMode={renderMode}
          />
        </aside>
      </div>

      <ConfirmDialog
        open={store.persistence.status === "conflict"}
        destructive
        title={t("builder:saveState.conflictTitle")}
        description={t("builder:saveState.conflictDescription")}
        confirmLabel={t("builder:saveState.reload")}
        onCancel={() => store.markDirty()}
        onConfirm={() => void store.load(workspaceId, projectId)}
      />
    </div>
  );
}
