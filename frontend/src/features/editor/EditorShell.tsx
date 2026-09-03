import { Eye, PanelLeftOpen, PanelRightOpen, Redo2, Rocket, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { blogTemplateApi } from "@/api/blog";
import { mediaUrl } from "@/api/media";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { RendererContext, type RendererContextValue } from "@/components/renderer/RendererContext";
import { PageMetadata } from "@/components/common/PageMetadata";
import { EditableCanvas } from "@/features/editor/canvas/EditableCanvas";
import { ElementsPanel } from "@/features/editor/panel/ElementsPanel";
import { countReferences, type ElementDefinition } from "@websitebuilder/shared";
import { LayersPanel } from "@/features/editor/panel/LayersPanel";
import { PageSettingsPanel } from "@/features/editor/panel/PageSettingsPanel";
import { PagesPanel } from "@/features/editor/panel/PagesPanel";
import { SiteSettingsPanel } from "@/features/editor/panel/SiteSettingsPanel";
import { resolvePanelView } from "@/features/editor/panel/panelMachine";
import { RightPanel } from "@/features/editor/panel/RightPanel";
import { DeviceSwitcher } from "@/features/editor/canvas/DeviceSwitcher";
import { SaveStateIndicator } from "@/features/editor/SaveStateIndicator";
import { canAcceptChild, findElement } from "@/features/editor/store/elements";
import {
  selectCurrentPage,
  selectHasUnsavedChanges,
  selectInsertionTarget,
  useEditorStore,
  type PanelMode,
} from "@/features/editor/store/editorStore";
import { useAuthoringCapability } from "@/features/editor/useAuthoringCapability";
import { useKeyboardShortcuts } from "@/features/editor/useKeyboardShortcuts";
import { BuilderFormsContext } from "@/features/forms/BuilderFormsContext";
import { useProjectForms } from "@/features/forms/useProjectForms";
import { canRedo, canUndo } from "@/features/editor/store/history";
import { useRelativeTime } from "@/hooks/useRelativeTime";
import { useUnsavedChangesWarning } from "@/hooks/useUnsavedChangesWarning";

/**
 * Editor layout: application navigation stays on the left (Phase 11 mounts the permanent sidebar),
 * the canvas occupies the centre, and every builder control lives in the fixed right panel. There
 * is deliberately no second builder-specific left sidebar.
 */
const PANEL_ID = "builder-right-panel";
const PANEL_COLLAPSED_KEY = "wb.builder.panelCollapsed";

function readPanelCollapsed(): boolean {
  try {
    return window.localStorage.getItem(PANEL_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function EditorShell({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  const { t } = useTranslation(["builder", "errors", "common"]);
  // Loaded only when the document actually holds a form block, so the majority of sites that have
  // none never make the request — and one appears the moment somebody inserts a block.
  const hasFormBlock = useEditorStore((state) => countReferences(state.history.present.pages, "forms") > 0);
  const projectForms = useProjectForms(workspaceId, projectId, { enabled: hasFormBlock });
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

  /**
   * The canvas renders through the same context the published page does.
   *
   * Media resolves to the workspace's own asset URLs — without this the canvas showed a grey
   * placeholder for every image a designer had already chosen — and forms resolve to the draft
   * definition, inert, so clicking a field selects the block rather than typing into it.
   */
  const rendererContext = useMemo(
    (): RendererContextValue => ({
      // Internal links stay unresolved here on purpose: clicking a button on the canvas selects it,
      // and a working link would navigate out of the builder.
      resolvePagePath: () => null,
      resolveMediaUrl: (mediaId) => mediaUrl(workspaceId, mediaId),
      resolveMediaVariantUrl: (mediaId, width) => mediaUrl(workspaceId, mediaId, width),
      resolveForm: projectForms.resolveForm,
      formMode: "inert",
      formStrings: {
        unbound: t("builder:form.unbound"),
        missing: t("builder:form.missing"),
        archived: t("builder:form.archived"),
        error: t("builder:form.error"),
        required: t("builder:form.required"),
      },
    }),
    [workspaceId, projectForms.resolveForm, t],
  );

  const builderForms = useMemo(
    () => ({
      workspaceId,
      projectId,
      forms: projectForms.forms,
      loading: projectForms.loading,
      reload: () => void projectForms.reload(),
    }),
    [workspaceId, projectId, projectForms.forms, projectForms.loading, projectForms.reload],
  );

  /**
   * Publishing a template, which the site's own publish does not do.
   *
   * The draft is saved first: pressing publish means "what I am looking at", and autosave may not
   * have fired yet — publishing the last autosaved state instead would put a version live that the
   * person never saw.
   */
  const [templateState, setTemplateState] = useState<
    "idle" | "publishing" | "done" | "blocked" | "conflict" | "error"
  >("idle");

  const publishTemplate = async () => {
    const target = store.target;
    if (target.kind !== "blogTemplate") return;

    setTemplateState("publishing");
    try {
      /*
       * A refused save stops the publication.
       *
       * Publishing promotes the stored draft, so continuing past a failed or conflicted save would
       * promote whatever last reached the server — a version the person is not looking at and did
       * not approve. Save used to swallow its own failures, which is what made that possible.
       */
      const saved = await store.save();
      if (!saved.ok) {
        setTemplateState(saved.reason === "conflict" ? "conflict" : "error");
        return;
      }

      const result = await blogTemplateApi.publish(workspaceId, projectId, target.templateKind);
      setTemplateState(result.published ? "done" : "blocked");
    } catch {
      setTemplateState("error");
    }
  };

  /**
   * Reloads what is actually open.
   *
   * Both recovery paths called the project loader. On a template that replaced the layout being
   * edited with the site's own document — losing the work and leaving the target pointing at a
   * template whose draft nobody had read.
   */
  const reloadCurrentTarget = () => {
    const target = store.target;
    return target.kind === "blogTemplate"
      ? store.loadBlogTemplate(workspaceId, projectId, target.templateKind)
      : store.load(workspaceId, projectId);
  };

  useUnsavedChangesWarning(hasUnsaved);
  // Shortcuts are mounted only where authoring is allowed, never in the preview-only shell.
  useKeyboardShortcuts(capability.canAuthor);

  /*
   * Whether the right panel is collapsed, remembered across sessions.
   *
   * Someone who works on a laptop collapses it for the same reason every time they open the builder,
   * and an editor that forgets makes them say it again every time. `localStorage` matches how the
   * element catalog already keeps its recents and favourites; a rejected read (private mode, a
   * blocked origin) falls back to expanded rather than failing the render.
   */
  const [panelCollapsed, setPanelCollapsed] = useState(readPanelCollapsed);

  useEffect(() => {
    try {
      window.localStorage.setItem(PANEL_COLLAPSED_KEY, panelCollapsed ? "1" : "0");
    } catch {
      // A preference that cannot be stored is still a preference for this session.
    }
  }, [panelCollapsed]);

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
            to={`/preview/${workspaceId}/${projectId}?device=desktop`}
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

  /**
   * Why a block cannot be inserted where it would currently go.
   *
   * Only reasons that are true right now and that the person can act on. There is deliberately no
   * entitlement state here: every workspace resolves to the same plan today, and a disabled row
   * explaining a limit nobody has would be an invented restriction.
   */
  const unavailableReason = (definition: ElementDefinition): string | undefined => {
    if (definition.type !== "container") return undefined;

    const target = selectInsertionTarget(store);
    if (target?.containerId === undefined) return undefined;

    const parent = findElement(store.history.present, target.containerId);
    return parent !== null && !canAcceptChild(parent) ? t("builder:canvas.tooDeep") : undefined;
  };

  const renderMode = (mode: PanelMode) => {
    switch (mode) {
      case "pages":
        return <PagesPanel />;
      case "elements":
        return (
          <ElementsPanel
            /* Which blocks exist here at all. A blog template offers the bound ones and an
               ordinary page does not, because a block with no record behind it renders nothing. */
            context={store.target.kind === "blogTemplate" ? "blogTemplate" : "page"}
            onAdd={(type) => store.insertElement(type)}
            onInsertPattern={(patternId) =>
              store.insertPattern(patternId, (key) => t(`builder:patterns.${key}` as "builder:patterns.hero.name"))
            }
            destination={destinationLabel()}
            unavailable={unavailableReason}
          />
        );
      case "layers":
        return <LayersPanel />;
      case "pageSettings":
        return <PageSettingsPanel />;
      case "siteSettings":
        return <SiteSettingsPanel workspaceId={workspaceId} projectId={projectId} />;
    }
  };

  return (
    <BuilderFormsContext.Provider value={builderForms}>
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
            onResolveConflict={() => void reloadCurrentTarget()}
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
          {/*
            A template publishes itself, and does so from here.

            Publishing a site does not carry a template: the two are stored apart because a layout
            change reaches every article at once, rather than waiting for whenever somebody next
            publishes the site. Without this button a designed layout could be saved forever and seen
            by nobody, which is the state the whole feature was in before it existed.
          */}
          {store.target.kind === "blogTemplate" ? (
            <button
              type="button"
              onClick={() => void publishTemplate()}
              disabled={templateState === "publishing"}
              className="flex items-center gap-1.5 rounded-md bg-accent-600 px-3 py-1.5 text-xs font-semibold
                text-white hover:bg-accent-700 disabled:opacity-50"
            >
              <Rocket aria-hidden className="size-3.5" />
              {t(templateState === "publishing" ? "builder:topBar.publishing" : "builder:topBar.publishTemplate")}
            </button>
          ) : (
          <>
          {/*
            Named for where it goes, not for what it does.
            
            It was called "Publish", it is a link, and it publishes nothing — so pressing it, landing
            on a screen also headed "Publish", and leaving reads as a site that went live. It does
            not: the act is a separate button on that screen, behind a confirmation. Somebody spent a
            day believing their page was published while the site served a snapshot from before they
            wrote it.
          */}
          <Link
            to={`/app/${workspaceId}/sites/${projectId}/publish`}
            className="flex items-center gap-1.5 rounded-md bg-accent-600 px-3 py-1.5 text-xs font-semibold
              text-white hover:bg-accent-700"
          >
            <Rocket aria-hidden className="size-3.5" />
            {t("builder:topBar.publish")}
          </Link>
          </>
          )}
        </div>
      </header>

      {templateState !== "idle" && templateState !== "publishing" && (
        <p
          role={templateState === "done" ? "status" : "alert"}
          className={[
            "border-b px-4 py-2 text-xs",
            templateState === "done"
              ? "border-accent-200 bg-accent-50 text-accent-900"
              : "border-red-200 bg-red-50 text-red-900",
          ].join(" ")}
        >
          {t(
            templateState === "done"
              ? "builder:topBar.templatePublished"
              : templateState === "blocked"
                ? "builder:topBar.templateBlocked"
                : templateState === "conflict"
                  ? "builder:topBar.templateConflict"
                  : "builder:topBar.templateFailed",
          )}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1">
          <RendererContext.Provider value={rendererContext}>
            <EditableCanvas page={page} />
          </RendererContext.Provider>
        </main>

        {/*
          * One fixed width, or none at all.
          *
          * The width never varies with the panel *mode* — switching from Structure to the inspector
          * must not resize or jump the canvas underneath the person's pointer. Collapsing is a
          * different thing entirely: it is a deliberate request for the 320px back, and on a laptop
          * that is the difference between seeing the page and seeing two thirds of it.
          */}
        <aside
          aria-label={t("builder:panel.label")}
          className={[
            "flex min-h-0 shrink-0 flex-col border-l border-ink-100 bg-white",
            panelCollapsed ? "w-10" : "w-80",
          ].join(" ")}
        >
          {/* In the flow rather than floating over the panel: an overlaid toggle sat on top of the
              rail's first tab and swallowed the clicks meant for it. */}
          <div className="flex shrink-0 justify-end border-b border-ink-100 p-1">
            <button
              type="button"
              onClick={() => setPanelCollapsed((collapsed) => !collapsed)}
              aria-expanded={!panelCollapsed}
              aria-controls={PANEL_ID}
              aria-label={t(panelCollapsed ? "builder:panel.expand" : "builder:panel.collapse")}
              title={t(panelCollapsed ? "builder:panel.expand" : "builder:panel.collapse")}
              className="rounded p-1 text-ink-500 hover:bg-ink-100 hover:text-ink-900"
            >
              {panelCollapsed ? (
                <PanelLeftOpen aria-hidden className="size-4" />
              ) : (
                <PanelRightOpen aria-hidden className="size-4" />
              )}
            </button>
          </div>

          {/* Unmounted rather than hidden: a collapsed panel keeps no focusable control, and the
              inspector stops re-rendering on every canvas change nobody is looking at. */}
          <div id={PANEL_ID} hidden={panelCollapsed} className="min-h-0 flex-1 overflow-auto">
            {!panelCollapsed && (
              <RightPanel
                view={view}
                page={page}
                pages={store.history.present.pages}
                panelMode={store.ui.panelMode}
                onPanelMode={store.setPanelMode}
                onBack={() => store.select(null)}
                renderMode={renderMode}
              />
            )}
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={store.persistence.status === "conflict"}
        destructive
        title={t("builder:saveState.conflictTitle")}
        description={t("builder:saveState.conflictDescription")}
        confirmLabel={t("builder:saveState.reload")}
        onCancel={() => store.markDirty()}
        onConfirm={() => void reloadCurrentTarget()}
      />
    </div>
    </BuilderFormsContext.Provider>
  );
}
