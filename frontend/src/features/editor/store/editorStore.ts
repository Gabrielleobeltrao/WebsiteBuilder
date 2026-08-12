import {
  autoFitPageToDevice,
  DEVICE_ORDER,
  deviceForWidth,
  deviceReferenceWidth,
  migrateDocumentResponsive,
  type DeviceMode,
} from "@websitebuilder/shared";
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
import type { InsertionTarget } from "./elements";
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

export type PanelMode = "pages" | "elements" | "layers" | "pageSettings" | "siteSettings";
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
    /** Whether the panel is showing the chosen destination or the selection's inspector. */
    panelIntent: "destination" | "inspector";
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
  /** The device being authored. Every geometry and style write lands on this one. */
  setEditingDevice: (device: DeviceMode) => void;
  /** Fits the current page's escaping elements to the device being authored. Returns how many. */
  autoFitCurrentPage: () => number;
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
  /** Creates an element at an explicit target, or at the resolved destination when none is given. */
  insertElement: (type: ElementType, target?: InsertionTarget) => void;
  moveElementTo: (elementId: string, target: InsertionTarget) => void;
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

  addSection: (layoutMode?: SectionLayoutMode, atIndex?: number) => void;
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
    locale: "en-US",
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

  function applyDocument(next: BuilderDocumentInput) {
    // commit() knows whether a transaction is open and whether it has already contributed a step,
    // so the store no longer needs a parallel notion of "transactional".
    set((state) => ({ history: history.commit(state.history, next), persistence: { status: "dirty" } }));
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
      panelIntent: "destination",
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
      // Documents authored before device overrides existed have elements that leave the screen on a
      // phone. Migration gives those an explicit narrow layout and touches nothing else — desktop
      // is never written, an override somebody already made is never replaced, and running it twice
      // changes nothing the second time.
      const { document } = migrateDocumentResponsive(toDocumentInput(project));
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
      applyDocument(next);
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
          panelIntent: target === null ? "destination" : "inspector",
          // Clearing the selection returns to the destination the user last chose on purpose.
          panelMode: target === null ? state.ui.lastPanelMode : state.ui.panelMode,
        },
      }));
    },

    setPanelMode(mode) {
      // The selection survives: a person opening the library to add something to the container they
      // just selected is the ordinary case, not an edge one.
      set((state) => ({ ui: { ...state.ui, panelMode: mode, lastPanelMode: mode, panelIntent: "destination" } }));
    },

    setZoom(zoom) {
      set((state) => ({ ui: { ...state.ui, zoom: Math.max(0.1, Math.min(4, zoom)) } }));
    },

    setEditingWidth(width) {
      set((state) => ({ ui: { ...state.ui, editingWidth: Math.max(320, Math.min(1920, Math.round(width))) } }));
    },

    setEditingDevice(device) {
      // Stored as a width because the canvas renders at one, and derived back to a device wherever
      // a write needs to know which override it belongs to. One value, so the two can never
      // disagree about which device is on screen.
      set((state) => ({ ui: { ...state.ui, editingWidth: deviceReferenceWidth(device) } }));
    },

    autoFitCurrentPage() {
      const device = selectEditingDevice(get());
      const pageId = selectCurrentPage(get())?.id;
      if (pageId === undefined) return 0;

      let changed = 0;
      // One update, so it is one undo. A repair that takes five presses of undo to reverse is a
      // repair people stop trusting.
      get().update((document) => ({
        ...document,
        pages: document.pages.map((page) => {
          if (page.id !== pageId) return page;
          const result = autoFitPageToDevice(page, device);
          changed = result.changed.length;
          return result.page;
        }),
      }));

      return changed;
    },

    setBreakpointOverride(elementId, breakpointId, part, values) {
      // Geometry written for a device is pixels on that device's canvas. Recording which canvas is
      // what lets the compiler read it back correctly instead of assuming the desktop one.
      get().update((document) =>
        elementOps.updateElement(document, elementId, (element) => ({
          ...element,
          breakpointOverrides: {
            ...element.breakpointOverrides,
            [breakpointId]: {
              ...element.breakpointOverrides?.[breakpointId],
              [part]: { ...element.breakpointOverrides?.[breakpointId]?.[part], ...values },
              ...(part === "geometry" && isDeviceMode(breakpointId)
                ? { referenceWidth: deviceReferenceWidth(breakpointId) }
                : {}),
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
          // Typed as a plain record here: the union's own type is the intersection of every
          // element's, which narrows to nothing indexable once every element type carries it.
          const overrides: Record<string, Record<string, unknown>> = {
            ...(element.breakpointOverrides as Record<string, Record<string, unknown>> | undefined),
          };
          const forBreakpoint = { ...overrides[breakpointId], [part]: rest };

          // An empty override object would keep reporting the value as overridden.
          if (Object.keys(rest).length === 0) {
            delete (forBreakpoint as Record<string, unknown>)[part];
            // The recorded canvas describes geometry. With the geometry gone it describes nothing,
            // and leaving it behind keeps the device looking overridden when it is not.
            if (part === "geometry") delete (forBreakpoint as Record<string, unknown>).referenceWidth;
          }
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

    insertElement(type, target) {
      const state = get();
      const page = selectCurrentPage(state);
      if (page === undefined || page === null) return;

      // One transaction for the whole insertion, including the section it may have to create first:
      // a person who undoes an accidental drop expects the empty section to go with it.
      state.beginTransaction(`insert:${type}`);

      let destination = target ?? selectInsertionTarget(state);
      if (destination === null) {
        // Nothing was selected, so there is no destination to infer. A structured section at the
        // page bottom is the one answer that is always valid and always visible.
        state.addSection("flex");
        const created = get().history.present.pages.find((candidate) => candidate.id === page.id);
        const last = created?.sections[created.sections.length - 1];
        if (last === undefined) {
          get().endTransaction();
          return;
        }
        destination = { sectionId: last.id };
      }

      let elementId: string | null = null;
      get().update((document) => {
        const result = elementOps.insertElement(document, page.id, type, destination);
        elementId = result.elementId;
        return result.elementId === null ? document : result.document;
      });
      get().endTransaction();

      if (elementId !== null) get().select({ kind: "element", elementId });
    },

    moveElementTo(elementId, target) {
      const pageId = selectCurrentPage(get())?.id;
      if (pageId === undefined) return;
      get().update((document) => elementOps.moveElementTo(document, pageId, elementId, target));
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

    /**
     * Writes geometry to the device being authored.
     *
     * On desktop that is the element's base geometry, which is what every other device inherits. On
     * a narrower device it is that device's override, and only the keys that actually changed —
     * so dragging on mobile cannot silently move the element on a laptop, which is what happened
     * before and was invisible until somebody opened the site on one.
     */
    moveElement(elementId, geometry) {
      const device = selectEditingDevice(get());
      if (device === "desktop") {
        get().update((document) => elementOps.moveElement(document, elementId, geometry));
        return;
      }

      get().setBreakpointOverride(elementId, device, "geometry", geometry);
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

    addSection(layoutMode = "free", atIndex) {
      const pageId = selectCurrentPage(get())?.id;
      if (pageId === undefined) return;

      let created: string | null = null;
      get().update((document) => {
        const result = sectionOps.addSection(document, pageId, layoutMode, atIndex);
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
/** The device the canvas is showing, which is the device every edit writes to. */
/** Whether a breakpoint id names one of the three devices rather than something else. */
function isDeviceMode(id: string): id is DeviceMode {
  return (DEVICE_ORDER as readonly string[]).includes(id);
}

/**
 * Where a click on a library item puts the element.
 *
 * A selected container takes it as a child; any other selection contributes its section. `null`
 * means nothing is selected and the caller has to create a destination — which is a deliberate
 * answer, not a failure: silently dropping the element into the first section on the page would put
 * it somewhere the person was not looking.
 */
export function selectInsertionTarget(state: EditorState): InsertionTarget | null {
  const page = selectCurrentPage(state);
  const selection = state.ui.selection;
  if (page === null || selection === null) return null;

  if (selection.kind === "section") {
    return page.sections.some((section) => section.id === selection.sectionId)
      ? { sectionId: selection.sectionId }
      : null;
  }

  const section = sectionOps.sectionOfElement(page, selection.elementId);
  if (section === null) return null;

  const selected = elementOps.findElement(state.history.present, selection.elementId);
  return selected?.type === "container"
    ? { sectionId: section.id, containerId: selected.id }
    : { sectionId: section.id };
}

export function selectEditingDevice(state: EditorState): DeviceMode {
  return deviceForWidth(state.ui.editingWidth);
}

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
