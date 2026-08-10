import type { BuilderDocumentInput, BuilderPage, BuilderProject } from "@websitebuilder/shared";
import { create } from "zustand";

import { ApiError } from "@/api/client";
import { projectsApi } from "@/api/projects";
import * as history from "./history";
import * as pageOps from "./pages";

/**
 * Editor state in four slices, exactly as the plan requires:
 *
 * - document: the builder document, owned by the history slice's `present`
 * - ui: current page, selection, zoom, panel mode — never part of undo history
 * - history: past/present/future with transaction boundaries
 * - persistence: clean/dirty/saving/saved/error/conflict
 *
 * Interactions update local state immediately. Nothing here calls the API per keystroke or per
 * dragged pixel: persistence happens on manual save and on a debounced autosave.
 */

export const AUTOSAVE_DELAY_MS = 1500;

export type PanelMode = "pages" | "elements" | "layers" | "pageSettings";
export type InspectorTarget = { kind: "section"; sectionId: string } | { kind: "element"; elementId: string };

export type PersistenceState =
  | { status: "clean" }
  | { status: "dirty" }
  | { status: "saving" }
  | { status: "saved"; at: string }
  | { status: "error"; code: string }
  | { status: "conflict"; currentRevision: number };

export type EditorState = {
  projectId: string | null;
  workspaceId: string | null;
  revision: number;
  loadStatus: "idle" | "loading" | "ready" | "error";
  loadErrorCode: string | null;

  history: history.HistoryState;
  ui: {
    currentPageId: string | null;
    selection: InspectorTarget | null;
    /** Panel mode to return to when the selection is cleared. */
    lastPanelMode: PanelMode;
    panelMode: PanelMode;
    zoom: number;
  };
  persistence: PersistenceState;

  load: (workspaceId: string, projectId: string, signal?: AbortSignal) => Promise<void>;
  loadFromProject: (project: BuilderProject) => void;

  save: () => Promise<void>;
  markDirty: () => void;

  update: (recipe: (document: BuilderDocumentInput) => BuilderDocumentInput) => void;
  beginTransaction: (label: string) => void;
  endTransaction: () => void;
  undo: () => void;
  redo: () => void;

  setCurrentPage: (pageId: string) => void;
  select: (target: InspectorTarget | null) => void;
  setPanelMode: (mode: PanelMode) => void;
  setZoom: (zoom: number) => void;

  addPage: (name: string) => void;
  renamePage: (pageId: string, name: string) => void;
  setPageSlug: (pageId: string, slug: string) => void;
  duplicatePage: (pageId: string) => void;
  deletePage: (pageId: string) => void;
  reorderPages: (from: number, to: number) => void;
  setHomePage: (pageId: string) => void;
};

function toDocumentInput(project: BuilderProject): BuilderDocumentInput {
  return {
    schemaVersion: project.schemaVersion,
    name: project.name,
    slug: project.slug,
    breakpoints: project.breakpoints,
    pages: project.pages,
    sharedSections: project.sharedSections,
    seo: project.seo,
    featureStates: project.featureStates,
  };
}

const EMPTY_DOCUMENT: BuilderDocumentInput = {
  schemaVersion: 1,
  name: "",
  slug: "",
  breakpoints: [],
  pages: [],
  sharedSections: [],
  seo: {
    siteName: "",
    titleTemplate: "%s",
    defaultDescription: "",
    locale: "pt-BR",
    defaultRobots: { index: true, follow: true },
  },
  featureStates: [],
};

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

export const useEditorStore = create<EditorState>((set, get) => {
  /** Schedules the debounced autosave, restarting the window on every further change. */
  function scheduleAutosave() {
    if (autosaveTimer !== null) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      const state = get();
      // A conflict must be resolved by the user; retrying it would overwrite newer data.
      if (state.persistence.status === "dirty") void state.save();
    }, AUTOSAVE_DELAY_MS);
  }

  function applyDocument(next: BuilderDocumentInput, options: { transactional?: boolean } = {}) {
    set((state) => ({
      history: options.transactional
        ? { ...state.history, present: next, future: [] }
        : history.commit(state.history, next),
      persistence: { status: "dirty" },
    }));
    scheduleAutosave();
  }

  return {
    projectId: null,
    workspaceId: null,
    revision: 0,
    loadStatus: "idle",
    loadErrorCode: null,
    history: history.createHistory(EMPTY_DOCUMENT),
    ui: {
      currentPageId: null,
      selection: null,
      lastPanelMode: "pages",
      panelMode: "pages",
      zoom: 1,
    },
    persistence: { status: "clean" },

    async load(workspaceId, projectId, signal) {
      set({ loadStatus: "loading", loadErrorCode: null });
      try {
        const project = await projectsApi.load(workspaceId, projectId, signal ? { signal } : {});
        get().loadFromProject(project);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        set({
          loadStatus: "error",
          loadErrorCode: error instanceof ApiError ? error.code : "INTERNAL_ERROR",
        });
      }
    },

    loadFromProject(project) {
      const document = toDocumentInput(project);
      const home = project.pages.find((page) => page.isHome) ?? project.pages[0];
      set((state) => ({
        projectId: project.id,
        workspaceId: project.workspaceId,
        revision: project.revision,
        loadStatus: "ready",
        loadErrorCode: null,
        // Loading replaces the document and must not become an undoable step.
        history: history.reset(document),
        persistence: { status: "clean" },
        ui: { ...state.ui, currentPageId: home?.id ?? null, selection: null },
      }));
    },

    async save() {
      const state = get();
      const { workspaceId, projectId } = state;
      if (workspaceId === null || projectId === null) return;
      if (state.persistence.status === "saving") return;

      if (autosaveTimer !== null) {
        clearTimeout(autosaveTimer);
        autosaveTimer = null;
      }

      const document = state.history.present;
      const revision = state.revision;
      set({ persistence: { status: "saving" } });

      try {
        const saved = await projectsApi.saveDocument(workspaceId, projectId, revision, document);
        set((current) => ({
          revision: saved.revision,
          // A save must not create an undo step, and it must not discard edits made while it was
          // in flight: only the persistence state changes if the document moved on.
          persistence:
            current.history.present === document
              ? { status: "saved", at: saved.updatedAt }
              : { status: "dirty" },
        }));
        if (get().persistence.status === "dirty") scheduleAutosave();
      } catch (error) {
        if (error instanceof ApiError && error.code === "REVISION_CONFLICT") {
          const current = Number(error.details?.[0]?.message.replace(/\D+/g, "") ?? 0);
          set({ persistence: { status: "conflict", currentRevision: current } });
          return;
        }
        // Failure keeps the document dirty so nothing is lost and the user can retry.
        set({ persistence: { status: "error", code: error instanceof ApiError ? error.code : "INTERNAL_ERROR" } });
      }
    },

    markDirty() {
      set({ persistence: { status: "dirty" } });
      scheduleAutosave();
    },

    update(recipe) {
      const state = get();
      const next = recipe(state.history.present);
      if (next === state.history.present) return;
      applyDocument(next, { transactional: state.history.transaction !== null });
    },

    beginTransaction(label) {
      set((state) => ({ history: history.beginTransaction(state.history, label) }));
    },

    endTransaction() {
      set((state) => ({ history: history.endTransaction(state.history) }));
    },

    undo() {
      set((state) => (history.canUndo(state.history) ? { history: history.undo(state.history) } : state));
      if (get().history.past.length >= 0) get().markDirty();
    },

    redo() {
      set((state) => (history.canRedo(state.history) ? { history: history.redo(state.history) } : state));
      get().markDirty();
    },

    setCurrentPage(pageId) {
      set((state) => ({ ui: { ...state.ui, currentPageId: pageId, selection: null } }));
    },

    select(target) {
      set((state) => ({
        ui: {
          ...state.ui,
          selection: target,
          // Remember where to return when the selection is cleared.
          lastPanelMode: target === null ? state.ui.lastPanelMode : state.ui.lastPanelMode,
          panelMode: target === null ? state.ui.lastPanelMode : state.ui.panelMode,
        },
      }));
    },

    setPanelMode(mode) {
      set((state) => ({ ui: { ...state.ui, panelMode: mode, lastPanelMode: mode, selection: null } }));
    },

    setZoom(zoom) {
      set((state) => ({ ui: { ...state.ui, zoom: Math.max(0.1, Math.min(4, zoom)) } }));
    },

    addPage(name) {
      get().update((document) => pageOps.addPage(document, name));
    },
    renamePage(pageId, name) {
      get().update((document) => pageOps.renamePage(document, pageId, name));
    },
    setPageSlug(pageId, slug) {
      get().update((document) => pageOps.setPageSlug(document, pageId, slug));
    },
    duplicatePage(pageId) {
      get().update((document) => pageOps.duplicatePage(document, pageId));
    },
    deletePage(pageId) {
      const state = get();
      state.update((document) => pageOps.deletePage(document, pageId));
      if (state.ui.currentPageId === pageId) {
        const first = get().history.present.pages[0];
        if (first) get().setCurrentPage(first.id);
      }
    },
    reorderPages(from, to) {
      get().update((document) => pageOps.reorderPages(document, from, to));
    },
    setHomePage(pageId) {
      get().update((document) => pageOps.setHomePage(document, pageId));
    },
  };
});

/** Current page, or null before a project is loaded. */
export function selectCurrentPage(state: EditorState): BuilderPage | null {
  const { currentPageId } = state.ui;
  const pages = state.history.present.pages;
  return pages.find((page) => page.id === currentPageId) ?? pages[0] ?? null;
}

export function selectHasUnsavedChanges(state: EditorState): boolean {
  return state.persistence.status === "dirty" || state.persistence.status === "error";
}

/** Test helper: resets the module-level autosave timer between cases. */
export function cancelPendingAutosave(): void {
  if (autosaveTimer !== null) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
}
