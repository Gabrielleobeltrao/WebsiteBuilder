import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createProjectDocument, type BuilderProject } from "@websitebuilder/shared";

import { cancelPendingAutosave, selectCurrentPage, useEditorStore } from "@/features/editor/store/editorStore";
import { createElement } from "@/features/editor/store/elements";

/**
 * What the editor is editing, and what a save is allowed to do about it.
 *
 * The store is shared by the site builder and the blog template editor. The only things that differ
 * are where a load reads from and where a save writes, which makes the target the most dangerous
 * piece of state in the file: get it wrong and a person's site is written to the template endpoint,
 * or their template is overwritten with a page.
 */

const project = (): BuilderProject => ({
  id: "aaaaaaaaaaaaaaaaaaaaaaaa",
  workspaceId: "w1",
  createdByUserId: "u1",
  revision: 3,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
  ...createProjectDocument({ name: "Acme", slug: "acme" }),
});

const template = (overrides: Record<string, unknown> = {}) => ({
  id: "t1",
  kind: "article" as const,
  draftDocument: { ...createProjectDocument({ name: "T", slug: "t-site" }).pages[0]!, slug: "" },
  draftVersion: 4,
  fieldDefinitions: [{ id: "f1", key: "subtitle", label: "Subtitle", type: "shortText", required: false }],
  updatedAt: "2026-08-02T00:00:00.000Z",
  ...overrides,
});

const load = vi.fn();
const save = vi.fn();
const publish = vi.fn();
const saveProjectDocument = vi.fn();

vi.mock("@/api/blog", () => ({
  blogTemplateApi: {
    load: (...args: unknown[]) => load(...args),
    save: (...args: unknown[]) => save(...args),
    publish: (...args: unknown[]) => publish(...args),
  },
}));

vi.mock("@/api/projects", () => ({
  projectsApi: {
    load: async () => project(),
    saveDocument: (...args: unknown[]) => saveProjectDocument(...args),
  },
}));

beforeEach(() => {
  cancelPendingAutosave();
  load.mockResolvedValue(template());
  save.mockResolvedValue(template({ draftVersion: 5 }));
  saveProjectDocument.mockResolvedValue({ ...project(), revision: 4 });
});

afterEach(() => {
  cancelPendingAutosave();
  vi.clearAllMocks();
});

describe("what a save writes to", () => {
  it("goes back to the project endpoint after a template was open", async () => {
    const store = useEditorStore.getState();
    await store.loadBlogTemplate("w1", "p1", "article");
    expect(useEditorStore.getState().target.kind).toBe("blogTemplate");

    store.loadFromProject(project());
    await useEditorStore.getState().save();

    // The dangerous direction: a site saved to the blog-template endpoint overwrites a layout with
    // a page, and the person sees a successful save.
    expect(save).not.toHaveBeenCalled();
    expect(saveProjectDocument).toHaveBeenCalled();
    expect(useEditorStore.getState().target.kind).toBe("project");
  });

  it("keeps the template's field definitions instead of clearing them", async () => {
    const store = useEditorStore.getState();
    await store.loadBlogTemplate("w1", "p1", "article");
    await useEditorStore.getState().save();

    // Opening a template and saving it used to send an empty list, erasing definitions the author
    // never touched.
    expect(save.mock.calls[0]?.[3]).toMatchObject({
      fieldDefinitions: [expect.objectContaining({ key: "subtitle" })],
    });
  });
});

describe("what a save reports", () => {
  it("says it succeeded", async () => {
    useEditorStore.getState().loadFromProject(project());
    await expect(useEditorStore.getState().save()).resolves.toMatchObject({ ok: true });
  });

  it("says it failed, rather than resolving as though it had not", async () => {
    saveProjectDocument.mockRejectedValue(new Error("network"));
    useEditorStore.getState().loadFromProject(project());

    // Publish calls save first. A save that swallows its own failure lets publication promote the
    // last version that did save — content the person never saw.
    await expect(useEditorStore.getState().save()).resolves.toMatchObject({ ok: false });
  });
});

/**
 * A template holding a block its catalog no longer offers.
 *
 * Article and index layouts now have separate allowlists, so a post feed placed in an article back
 * when both shared one catalog is no longer offered there. Narrowing what may be *added* must not
 * narrow what may be kept: a layout that silently dropped, froze or refused to save that block
 * would destroy work the author still sees on their published site.
 */
describe("a block that is stored but no longer offered", () => {
  const articleHoldingAPostFeed = () => {
    const page = createProjectDocument({ name: "T", slug: "t-site" }).pages[0]!;
    const section = page.sections[0]!;
    const stored = createElement("postCollection", { section });
    return template({
      draftDocument: {
        ...page,
        slug: "",
        sections: [{ ...section, elements: [...section.elements, stored] }],
      },
    });
  };

  const elements = () => selectCurrentPage(useEditorStore.getState())?.sections[0]?.elements ?? [];

  it("survives being loaded into the editor", async () => {
    load.mockResolvedValue(articleHoldingAPostFeed());
    await useEditorStore.getState().loadBlogTemplate("w1", "p1", "article");

    expect(elements().map((element) => element.type)).toContain("postCollection");
  });

  it("can still be renamed and deleted", async () => {
    load.mockResolvedValue(articleHoldingAPostFeed());
    await useEditorStore.getState().loadBlogTemplate("w1", "p1", "article");
    const stored = elements().find((element) => element.type === "postCollection")!;

    useEditorStore.getState().renameElement(stored.id, "Older feed");
    expect(elements().find((element) => element.id === stored.id)?.name).toBe("Older feed");

    useEditorStore.getState().deleteElement(stored.id);
    expect(elements().some((element) => element.id === stored.id)).toBe(false);
  });

  it("saves back without being stripped", async () => {
    load.mockResolvedValue(articleHoldingAPostFeed());
    await useEditorStore.getState().loadBlogTemplate("w1", "p1", "article");
    useEditorStore.getState().renameElement(elements()[0]!.id, "Heading");

    await useEditorStore.getState().save();

    const sent = save.mock.calls[0]?.[3] as { draftDocument: { sections: { elements: { type: string }[] }[] } };
    expect(sent.draftDocument.sections[0]?.elements.map((element) => element.type)).toContain("postCollection");
  });
});
