import { Redo2, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { PageMetadata } from "@/components/common/PageMetadata";
import { EditableCanvas } from "@/features/editor/canvas/EditableCanvas";
import { ElementsPanel } from "@/features/editor/panel/ElementsPanel";
import { LayersPanel } from "@/features/editor/panel/LayersPanel";
import { PageSettingsPanel } from "@/features/editor/panel/PageSettingsPanel";
import { PageSeoPanel } from "@/features/editor/inspector/PageSeoPanel";
import { PagesPanel } from "@/features/editor/panel/PagesPanel";
import { resolvePanelView } from "@/features/editor/panel/panelMachine";
import { RightPanel } from "@/features/editor/panel/RightPanel";
import { WidthControl } from "@/features/editor/canvas/WidthControl";
import { SaveStateIndicator } from "@/features/editor/SaveStateIndicator";
import {
  selectCurrentPage,
  selectHasUnsavedChanges,
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
  const view = resolvePanelView({ panelMode: store.ui.panelMode, selection: store.ui.selection });

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
            to={`/preview/${projectId}`}
            className="rounded-md border border-ink-200 px-4 py-2 text-sm font-medium text-ink-700"
          >
            {t("builder:gate.previewMobile")}
          </Link>
          <Link
            to={`/preview/${projectId}?viewport=desktop`}
            className="rounded-md border border-ink-200 px-4 py-2 text-sm font-medium text-ink-700"
          >
            {t("builder:gate.previewDesktop")}
          </Link>
        </div>
      </div>
    );
  }

  const renderMode = (mode: PanelMode) => {
    switch (mode) {
      case "pages":
        return <PagesPanel />;
      case "elements":
        return (
          <ElementsPanel
            onAdd={(type) => {
              const sectionId = page?.sections[0]?.id;
              if (sectionId) store.addElement(sectionId, type);
            }}
          />
        );
      case "layers":
        return <LayersPanel />;
      case "pageSettings":
        return <PageSettingsPanel />;
      case "pageSeo":
        return <PageSeoPanel />;
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
        </div>

        <div className="flex items-center gap-3">
          <WidthControl />
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
          <Link
            to={`/preview/${projectId}?viewport=desktop`}
            className="rounded-md border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-700"
          >
            {t("builder:topBar.previewDesktop")}
          </Link>
          <Link
            to={`/preview/${projectId}`}
            className="rounded-md border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-700"
          >
            {t("builder:topBar.previewMobile")}
          </Link>
          <button
            type="button"
            onClick={() => void store.save()}
            className="rounded-md bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-700"
          >
            {t("builder:topBar.save")}
          </button>
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
