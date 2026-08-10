import { createProjectDocument, type BuilderProject } from "@websitebuilder/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTOSAVE_DELAY_MS, cancelPendingAutosave, selectHasUnsavedChanges, useEditorStore } from "./editorStore";
import { createHistory } from "./history";

const project = (overrides: Partial<BuilderProject> = {}): BuilderProject => {
  const document = createProjectDocument({ name: "Acme", slug: "acme" });
  return {
    id: "aaaaaaaaaaaaaaaaaaaaaaaa",
    workspaceId: "w1",
    createdByUserId: "u1",
    revision: 3,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...document,
    ...overrides,
  };
};

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
  vi.stubGlobal("fetch", spy);
  return spy;
}

const savedResponse = (revision: number) =>
  new Response(JSON.stringify({ data: { ...project({ revision }), updatedAt: "2026-08-10T12:00:00.000Z" } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const conflictResponse = (currentRevision: number) =>
  new Response(
    JSON.stringify({
      error: {
        code: "REVISION_CONFLICT",
        message: "conflict",
        details: [{ path: "revision", message: `current revision is ${currentRevision}` }],
      },
    }),
    { status: 409, headers: { "content-type": "application/json" } },
  );

beforeEach(() => {
  vi.useFakeTimers();
  cancelPendingAutosave();
  useEditorStore.setState({
    projectId: null,
    workspaceId: null,
    revision: 0,
    loadStatus: "idle",
    loadErrorCode: null,
    history: createHistory(createProjectDocument({ name: "", slug: "empty-site" })),
    persistence: { status: "clean" },
    ui: { currentPageId: null, selection: null, lastPanelMode: "pages", panelMode: "pages", zoom: 1, editingWidth: 1440 },
  });
});

afterEach(() => {
  cancelPendingAutosave();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("loading", () => {
  it("populates the document, selects the homepage and starts clean", () => {
    useEditorStore.getState().loadFromProject(project());
    const state = useEditorStore.getState();

    expect(state.loadStatus).toBe("ready");
    expect(state.revision).toBe(3);
    expect(state.persistence.status).toBe("clean");
    expect(state.ui.currentPageId).toBe(state.history.present.pages[0]?.id);
  });

  it("does not create an undoable step", () => {
    useEditorStore.getState().loadFromProject(project());
    expect(useEditorStore.getState().history.past).toHaveLength(0);
  });
});

describe("autosave", () => {
  it("marks dirty on edit and saves after the debounce window", async () => {
    const spy = mockFetch(() => savedResponse(4));
    useEditorStore.getState().loadFromProject(project());

    useEditorStore.getState().addPage("About");
    expect(useEditorStore.getState().persistence.status).toBe("dirty");
    expect(spy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1);
    expect(spy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(useEditorStore.getState().persistence.status).toBe("saved");
    expect(useEditorStore.getState().revision).toBe(4);
  });

  it("restarts the window on every further edit instead of saving per change", async () => {
    const spy = mockFetch(() => savedResponse(4));
    useEditorStore.getState().loadFromProject(project());

    for (let index = 0; index < 5; index += 1) {
      useEditorStore.getState().addPage(`Page ${index}`);
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 100);
    }
    expect(spy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("sends the loaded revision so the server can reject a stale write", async () => {
    const spy = mockFetch(() => savedResponse(4));
    useEditorStore.getState().loadFromProject(project({ revision: 7 }));
    useEditorStore.getState().addPage("About");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);

    const body = JSON.parse(String(spy.mock.calls[0]?.[1]?.body)) as { revision: number };
    expect(body.revision).toBe(7);
  });
});

describe("manual save", () => {
  it("flushes immediately without waiting for the debounce", async () => {
    const spy = mockFetch(() => savedResponse(4));
    useEditorStore.getState().loadFromProject(project());
    useEditorStore.getState().addPage("About");

    await useEditorStore.getState().save();
    expect(spy).toHaveBeenCalledTimes(1);

    // The pending autosave must have been cancelled, not merely superseded.
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not add an undo step", async () => {
    mockFetch(() => savedResponse(4));
    useEditorStore.getState().loadFromProject(project());
    useEditorStore.getState().addPage("About");
    const before = useEditorStore.getState().history.past.length;

    await useEditorStore.getState().save();
    expect(useEditorStore.getState().history.past).toHaveLength(before);
  });

  it("keeps the document dirty when the save fails so nothing is lost", async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE", message: "down" } }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
    );
    useEditorStore.getState().loadFromProject(project());
    useEditorStore.getState().addPage("About");

    await useEditorStore.getState().save();
    const state = useEditorStore.getState();
    expect(state.persistence).toEqual({ status: "error", code: "SERVICE_UNAVAILABLE" });
    expect(selectHasUnsavedChanges(state)).toBe(true);
    expect(state.history.present.pages).toHaveLength(2);
  });

  it("surfaces a revision conflict and stops retrying it automatically", async () => {
    const spy = mockFetch(() => conflictResponse(9));
    useEditorStore.getState().loadFromProject(project({ revision: 3 }));
    useEditorStore.getState().addPage("About");

    await useEditorStore.getState().save();
    expect(useEditorStore.getState().persistence).toEqual({ status: "conflict", currentRevision: 9 });

    // An autosave must never resolve a conflict by overwriting newer data.
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 3);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("stays dirty when the document changed while the save was in flight", async () => {
    let resolveSave!: (response: Response) => void;
    const pendingSave = new Promise<Response>((resolve) => {
      resolveSave = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(() => pendingSave));

    useEditorStore.getState().loadFromProject(project());
    useEditorStore.getState().addPage("About");
    const saving = useEditorStore.getState().save();

    useEditorStore.getState().addPage("Contact");
    resolveSave(savedResponse(4));
    await saving;

    expect(useEditorStore.getState().persistence.status).toBe("dirty");
    expect(useEditorStore.getState().history.present.pages).toHaveLength(3);
  });
});

describe("ui state", () => {
  it("does not pollute history", () => {
    useEditorStore.getState().loadFromProject(project());
    const before = useEditorStore.getState().history;

    useEditorStore.getState().setZoom(2);
    useEditorStore.getState().setPanelMode("elements");
    useEditorStore.getState().select({ kind: "element", elementId: "x" });

    expect(useEditorStore.getState().history).toEqual(before);
    expect(useEditorStore.getState().persistence.status).toBe("clean");
  });

  it("clamps zoom to a usable range", () => {
    useEditorStore.getState().setZoom(99);
    expect(useEditorStore.getState().ui.zoom).toBe(4);
    useEditorStore.getState().setZoom(0);
    expect(useEditorStore.getState().ui.zoom).toBe(0.1);
  });

  it("returns to the remembered panel mode when the selection is cleared", () => {
    useEditorStore.getState().setPanelMode("layers");
    useEditorStore.getState().select({ kind: "element", elementId: "x" });
    useEditorStore.getState().select(null);
    expect(useEditorStore.getState().ui.panelMode).toBe("layers");
  });
});

describe("undo through the store", () => {
  it("reverts a page addition and marks the document dirty again", async () => {
    mockFetch(() => savedResponse(4));
    useEditorStore.getState().loadFromProject(project());

    useEditorStore.getState().addPage("About");
    expect(useEditorStore.getState().history.present.pages).toHaveLength(2);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().history.present.pages).toHaveLength(1);

    useEditorStore.getState().redo();
    expect(useEditorStore.getState().history.present.pages).toHaveLength(2);
  });
});
