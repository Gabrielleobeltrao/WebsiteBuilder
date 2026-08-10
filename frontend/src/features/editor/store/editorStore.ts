import {
  DESIGN_WIDTH,
  resolveBreakpointAt,
  type BreakpointDefinition,
} from "@websitebuilder/shared";
import type {
  BuilderDocumentInput,
  BuilderPage,
  BuilderProject,
  ElementType,
  Geometry,
  SectionLayoutMode,
} from "@websitebuilder/shared";
import { create } from "zustand";

import { ApiError } from "@/api/client";
import { projectsApi } from "@/api/projects";
import * as clipboardOps from "./clipboard";
import * as elementOps from "./elements";
import * as history from "./history";
import * as pageOps from "./pages";
import * as sectionOps from "./sections";

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
    /**
     * Width the canvas is being authored at. It selects which breakpoint's overrides are edited
     * and previewed; it is display state and never part of the document or of history.
     */
    editingWidth: number;
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
  setEditingWidth: (width: number) => void;
  setBreakpointOverride: (
    elementId: string,
    breakpointId: string,
    part: "layout" | "geometry",
    values: Record<string, unknown>,
  ) => void;
  clearBreakpointOverride: (elementId: string, breakpointId: string, part: "layout" | "geometry", key: string) => void;

  addPage: (name: string) => void;
  renamePage: (pageId: string, name: string) => void;
  setPageSlug: (pageId: string, slug: string) => void;
  duplicatePage: (pageId: string) => void;
  deletePage: (pageId: string) => void;
  reorderPages: (from: number, to: number) => void;
  setHomePage: (pageId: string) => void;

  addElement: (sectionId: string, type: ElementType, viewportCentre?: { x: number; y: number }) => void;
  deleteElement: (elementId: string) => void;
  duplicateElement: (elementId: string) => void;
  moveElement: (elementId: string, geometry: Geometry) => void;
  renameElement: (elementId: string, name: string) => void;
  setElementFlag: (elementId: string, flag: "locked" | "hidden", value: boolean) => void;
  changeZOrder: (elementId: string, direction: "forward" | "backward" | "front" | "back") => void;

  clipboard: clipboardOps.ClipboardState;
  copySelection: () => void;
  cutSelection: () => void;
  paste: () => void;

  addSection: (layoutMode?: SectionLayoutMode) => void;
  renameSection: (sectionId: string, name: string) => void;
  setSectionBackground: (sectionId: string, color: string) => void;
  setSectionHidden: (sectionId: string, hidden: boolean) => void;
  duplicateSection: (sectionId: string) => void;
  deleteSection: (sectionId: string) => void;
  reorderSections: (from: number, to: number) => void;
  convertSectionLayout: (sectionId: string, layoutMode: SectionLayoutMode) => void;
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
      editingWidth: DESIGN_WIDTH,
    },
    persistence: { status: "clean" },
    clipboard: null,

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

    setEditingWidth(width) {
      set((state) => ({ ui: { ...state.ui, editingWidth: Math.max(320, Math.min(1920, Math.round(width))) } }));
    },

    setBreakpointOverride(elementId, breakpointId, part, values) {
      get().update((document) =>
        elementOps.updateElement(document, elementId, (element) => ({
          ...element,
          breakpointOverrides: {
            ...element.breakpointOverrides,
            [breakpointId]: {
              ...element.breakpointOverrides?.[breakpointId],
              [part]: { ...element.breakpointOverrides?.[breakpointId]?.[part], ...values },
            },
          },
        })),
      );
    },

    clearBreakpointOverride(elementId, breakpointId, part, key) {
      get().update((document) =>
        elementOps.updateElement(document, elementId, (element) => {
          const existing = element.breakpointOverrides?.[breakpointId]?.[part];
          if (existing === undefined) return element;

          const { [key]: _removed, ...rest } = existing as Record<string, unknown>;
          const overrides = { ...element.breakpointOverrides };
          const forBreakpoint = { ...overrides[breakpointId], [part]: rest };

          // An empty override object would keep reporting the value as overridden.
          if (Object.keys(rest).length === 0) delete (forBreakpoint as Record<string, unknown>)[part];
          if (Object.keys(forBreakpoint).length === 0) delete overrides[breakpointId];
          else overrides[breakpointId] = forBreakpoint;

          return { ...element, breakpointOverrides: overrides };
        }),
      );
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

    addElement(sectionId, type, viewportCentre) {
      const state = get();
      const pageId = selectCurrentPage(state)?.id;
      if (pageId === undefined) return;

      let created: string | null = null;
      state.update((document) => {
        const result = elementOps.addElement(document, { pageId, sectionId }, type, viewportCentre);
        created = result.elementId;
        return result.document;
      });
      // Adding an element selects it, so the inspector opens on what the user just placed.
      if (created !== null) get().select({ kind: "element", elementId: created });
    },

    deleteElement(elementId) {
      get().update((document) => elementOps.deleteElement(document, elementId));
      const selection = get().ui.selection;
      if (selection?.kind === "element" && selection.elementId === elementId) get().select(null);
    },

    duplicateElement(elementId) {
      let created: string | null = null;
      get().update((document) => {
        const result = elementOps.duplicateElement(document, elementId);
        created = result.elementId;
        return result.document;
      });
      if (created !== null) get().select({ kind: "element", elementId: created });
    },

    moveElement(elementId, geometry) {
      get().update((document) => elementOps.moveElement(document, elementId, geometry));
    },

    renameElement(elementId, name) {
      get().update((document) => elementOps.renameElement(document, elementId, name));
    },

    setElementFlag(elementId, flag, value) {
      get().update((document) => elementOps.setElementFlag(document, elementId, flag, value));
    },

    changeZOrder(elementId, direction) {
      get().update((document) => elementOps.changeZOrder(document, elementId, direction));
    },

    copySelection() {
      const state = get();
      if (state.ui.selection?.kind !== "element") return;
      set({ clipboard: clipboardOps.copyElement(state.history.present, state.ui.selection.elementId) });
    },

    cutSelection() {
      const state = get();
      if (state.ui.selection?.kind !== "element") return;
      const elementId = state.ui.selection.elementId;

      let clipboard: clipboardOps.ClipboardState = null;
      state.update((document) => {
        const result = clipboardOps.cutElement(document, elementId);
        clipboard = result.clipboard;
        return result.document;
      });
      set({ clipboard });
      get().select(null);
    },

    paste() {
      const state = get();
      const page = selectCurrentPage(state);
      const sectionId = page?.sections[0]?.id;
      if (!page || sectionId === undefined || state.clipboard === null) return;

      let created: string | null = null;
      state.update((document) => {
        const result = clipboardOps.pasteElement(document, state.clipboard, { pageId: page.id, sectionId });
        created = result.elementId;
        return result.document;
      });
      if (created !== null) get().select({ kind: "element", elementId: created });
    },

    addSection(layoutMode = "free") {
      const pageId = selectCurrentPage(get())?.id;
      if (pageId === undefined) return;

      let created: string | null = null;
      get().update((document) => {
        const result = sectionOps.addSection(document, pageId, layoutMode);
        created = result.sectionId;
        return result.document;
      });
      if (created !== null) get().select({ kind: "section", sectionId: created });
    },

    renameSection(sectionId, name) {
      get().update((document) => sectionOps.renameSection(document, sectionId, name));
    },
    setSectionBackground(sectionId, color) {
      get().update((document) => sectionOps.setSectionBackground(document, sectionId, color));
    },
    setSectionHidden(sectionId, hidden) {
      get().update((document) => sectionOps.setSectionFlag(document, sectionId, "hidden", hidden));
    },
    duplicateSection(sectionId) {
      get().update((document) => sectionOps.duplicateSection(document, sectionId));
    },
    deleteSection(sectionId) {
      get().update((document) => sectionOps.deleteSection(document, sectionId));
      const selection = get().ui.selection;
      if (selection?.kind === "section" && selection.sectionId === sectionId) get().select(null);
    },
    reorderSections(from, to) {
      const pageId = selectCurrentPage(get())?.id;
      if (pageId === undefined) return;
      get().update((document) => sectionOps.reorderSections(document, pageId, from, to));
    },
    convertSectionLayout(sectionId, layoutMode) {
      get().update((document) => sectionOps.convertSectionLayout(document, sectionId, layoutMode));
    },
  };
});

/** Current page, or null before a project is loaded. */
export function selectCurrentPage(state: EditorState): BuilderPage | null {
  const { currentPageId } = state.ui;
  const pages = state.history.present.pages;
  return pages.find((page) => page.id === currentPageId) ?? pages[0] ?? null;
}

/** Breakpoint the editing width currently falls into, or the widest one as a fallback. */
export function selectEditingBreakpoint(state: EditorState): BreakpointDefinition | null {
  const breakpoints = state.history.present.breakpoints;
  return resolveBreakpointAt(state.ui.editingWidth, breakpoints) ?? breakpoints[0] ?? null;
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
