import { createProjectDocument, type BuilderProject } from "@websitebuilder/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cancelPendingAutosave, selectCurrentPage, useEditorStore } from "@/features/editor/store/editorStore";

/**
 * Two things open in one store.
 *
 * The builder is a single store shared by the site and both blog templates, and every load and save
 * is a round trip. Nothing stopped a response from a target the person had already left being
 * applied to the one they had just opened — a template's version number written onto a site, a
 * "saved" badge for a document nobody is looking at, or a slow load restoring the target they left.
 *
 * Every case here holds a request open on purpose and resolves it after the switch, because that is
 * the only way to prove the late answer is discarded rather than merely usually late.
 */

/** A promise whose settlement this test controls. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });
  return { promise, resolve, reject };
}

const project = (overrides: Partial<BuilderProject> = {}): BuilderProject => ({
  id: "aaaaaaaaaaaaaaaaaaaaaaaa",
  workspaceId: "w1",
  createdByUserId: "u1",
  revision: 3,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
  ...createProjectDocument({ name: "Acme", slug: "acme" }),
  ...overrides,
});

const template = () => ({
  id: "t1",
  kind: "article" as const,
  draftDocument: { ...createProjectDocument({ name: "T", slug: "t-site" }).pages[0]!, slug: "" },
  draftVersion: 4,
  fieldDefinitions: [{ id: "f1", key: "subtitle", label: "Subtitle", type: "shortText", required: false }],
  updatedAt: "2026-08-02T00:00:00.000Z",
});

const loadTemplate = vi.fn();
const saveTemplate = vi.fn();
const loadProject = vi.fn();
const saveProject = vi.fn();

vi.mock("@/api/blog", () => ({
  blogTemplateApi: {
    load: (...args: unknown[]) => loadTemplate(...args),
    save: (...args: unknown[]) => saveTemplate(...args),
    publish: vi.fn(),
  },
}));

vi.mock("@/api/projects", () => ({
  projectsApi: {
    load: (...args: unknown[]) => loadProject(...args),
    saveDocument: (...args: unknown[]) => saveProject(...args),
  },
}));

beforeEach(() => {
  cancelPendingAutosave();
  vi.useFakeTimers();
  loadTemplate.mockResolvedValue(template());
  saveTemplate.mockResolvedValue({ ...template(), draftVersion: 5 });
  loadProject.mockResolvedValue(project());
  saveProject.mockResolvedValue({ ...project(), revision: 4 });
});

afterEach(() => {
  cancelPendingAutosave();
  vi.useRealTimers();
  vi.clearAllMocks();
});

const state = () => useEditorStore.getState();

describe("a save that lands after the editor moved on", () => {
  it("does not write a template's version onto a project", async () => {
    const held = deferred<ReturnType<typeof template>>();
    saveTemplate.mockReturnValue(held.promise);

    await state().loadBlogTemplate("w1", "p1", "article");
    const saving = state().save();

    // The person leaves for the site while the template is still saving.
    state().loadFromProject(project({ revision: 9 }));
    held.resolve({ ...template(), draftVersion: 99 } as never);

    expect(await saving).toEqual({ ok: false, reason: "stale" });
    expect(state().target).toEqual({ kind: "project" });
    expect(state().revision).toBe(9);
  });

  it("does not write a project's revision onto a template", async () => {
    const held = deferred<BuilderProject>();
    saveProject.mockReturnValue(held.promise);

    state().loadFromProject(project({ revision: 3 }));
    const saving = state().save();

    await state().loadBlogTemplate("w1", "p1", "article");
    held.resolve(project({ revision: 77 }));

    expect(await saving).toEqual({ ok: false, reason: "stale" });
    expect(state().target).toMatchObject({ kind: "blogTemplate", templateKind: "article", version: 4 });
    // The template's own revision is zero; a project revision landing here would be meaningless.
    expect(state().revision).toBe(0);
  });

  it("does not carry one layout's version onto the other", async () => {
    const held = deferred<ReturnType<typeof template>>();
    saveTemplate.mockReturnValue(held.promise);

    await state().loadBlogTemplate("w1", "p1", "article");
    const saving = state().save();

    loadTemplate.mockResolvedValue({ ...template(), kind: "index", draftVersion: 2 });
    await state().loadBlogTemplate("w1", "p1", "index");
    held.resolve({ ...template(), draftVersion: 42 } as never);

    expect(await saving).toEqual({ ok: false, reason: "stale" });
    expect(state().target).toMatchObject({ kind: "blogTemplate", templateKind: "index", version: 2 });
  });

  it("leaves the new session's save state alone when the old one fails", async () => {
    const held = deferred<BuilderProject>();
    saveProject.mockReturnValue(held.promise);

    state().loadFromProject(project());
    const saving = state().save();

    await state().loadBlogTemplate("w1", "p1", "article");
    held.reject(new Error("network"));

    expect(await saving).toEqual({ ok: false, reason: "stale" });
    // A failure belonging to a document nobody is editing must not put this one into an error the
    // person cannot act on.
    expect(state().persistence).toEqual({ status: "clean" });
  });
});

describe("a load that lands after another was opened", () => {
  it("does not restore the target the person just left", async () => {
    const held = deferred<ReturnType<typeof template>>();
    loadTemplate.mockReturnValue(held.promise);

    const loading = state().loadBlogTemplate("w1", "p1", "article");
    state().loadFromProject(project({ revision: 5 }));
    held.resolve(template() as never);
    await loading;

    expect(state().target).toEqual({ kind: "project" });
    expect(state().revision).toBe(5);
    expect(state().loadStatus).toBe("ready");
  });

  it("keeps the newer document when an older load finishes last", async () => {
    const first = deferred<BuilderProject>();
    loadProject.mockReturnValue(first.promise);

    const stale = state().load("w1", "p1");

    loadProject.mockResolvedValue(project({ revision: 12, name: "Opened second" }));
    await state().load("w1", "p2");

    first.resolve(project({ revision: 1, name: "Opened first" }));
    await stale;

    expect(state().history.present.name).toBe("Opened second");
    expect(state().revision).toBe(12);
  });

  it("does not report a failed old load as this session's error", async () => {
    const failing = deferred<BuilderProject>();
    loadProject.mockReturnValue(failing.promise);

    const stale = state().load("w1", "p1");
    loadProject.mockResolvedValue(project());
    await state().load("w1", "p2");

    failing.reject(new Error("network"));
    await stale;

    expect(state().loadStatus).toBe("ready");
    expect(state().loadErrorCode).toBeNull();
  });
});

describe("an autosave scheduled before the switch", () => {
  it("never runs against the document that replaced it", async () => {
    state().loadFromProject(project());
    state().markDirty();

    await state().loadBlogTemplate("w1", "p1", "article");
    await vi.advanceTimersByTimeAsync(5_000);

    // The timer belonged to the site. Firing it here would save the template's page through the
    // project endpoint, which is how a layout overwrites a page.
    expect(saveProject).not.toHaveBeenCalled();
    expect(state().persistence).toEqual({ status: "clean" });
  });
});

describe("an edit made while a save is in flight", () => {
  it("is kept, and the document stays dirty rather than being called saved", async () => {
    const held = deferred<BuilderProject>();
    saveProject.mockReturnValue(held.promise);

    state().loadFromProject(project());
    const saving = state().save();

    const page = selectCurrentPage(state())!;
    state().addSection("flex");
    held.resolve({ ...project(), revision: 4 });

    expect(await saving).toEqual({ ok: true });
    expect(state().persistence.status).toBe("dirty");
    expect(selectCurrentPage(state())?.sections.length).toBeGreaterThan(page.sections.length);
  });
});
