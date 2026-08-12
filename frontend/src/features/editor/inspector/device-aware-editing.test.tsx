import { createProjectDocument } from "@websitebuilder/shared";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { SectionInspector } from "@/features/editor/inspector/SectionInspector";
import { cancelPendingAutosave, useEditorStore } from "@/features/editor/store/editorStore";
import { createHistory } from "@/features/editor/store/history";
import { renderWithProviders } from "@/test/render";

/**
 * Editing while a narrow device is selected must write that device's values.
 *
 * Today it does not: the section inspector writes `desktop` whatever the canvas is showing, and the
 * element inspector writes base geometry. The result is a builder where switching to Mobile and
 * changing something silently changes Desktop — which is worse than not offering the device
 * switcher at all, because the damage is invisible until someone opens the site on a laptop.
 */

const sectionOf = () => useEditorStore.getState().history.present.pages[0]!.sections[0]!;

beforeEach(() => {
  cancelPendingAutosave();
  useEditorStore.setState({
    loadStatus: "idle",
    loadErrorCode: null,
    history: createHistory(createProjectDocument({ name: "Acme", slug: "acme" })),
    persistence: { status: "clean" },
    ui: {
      currentPageId: null,
      selection: null,
      lastPanelMode: "pages",
      panelMode: "pages", panelIntent: "destination",
      zoom: 1,
      // The device the author is looking at. Every assertion below is about what a write does
      // while this is not desktop.
      editingWidth: 390,
    },
  });
});

/** Puts the fixture section into grid mode, which is where the per-breakpoint fields live. */
function asGrid() {
  const section = sectionOf();
  useEditorStore.setState((state) => ({
    history: {
      ...state.history,
      present: {
        ...state.history.present,
        pages: state.history.present.pages.map((page) => ({
          ...page,
          sections: page.sections.map((candidate) =>
            candidate.id === section.id ? { ...candidate, layoutMode: "grid" as const } : candidate,
          ),
        })),
      },
    },
  }));
  return sectionOf();
}

describe("editing a section while mobile is selected", () => {
  it("writes a mobile value rather than the desktop one", async () => {
    const user = userEvent.setup();
    const section = asGrid();
    const before = structuredClone(section.layoutByBreakpoint);

    renderWithProviders(<SectionInspector section={section} />);
    await user.clear(screen.getByLabelText("Row gap"));
    await user.type(screen.getByLabelText("Row gap"), "8");

    const after = sectionOf().layoutByBreakpoint;
    // The change belongs to the device being looked at. Desktop must be exactly what it was.
    expect(after["mobile"]).toBeDefined();
    expect(after["desktop"]).toEqual(before["desktop"]);
  });

  it("leaves tablet alone as well", async () => {
    const user = userEvent.setup();
    const section = asGrid();

    renderWithProviders(<SectionInspector section={section} />);
    await user.clear(screen.getByLabelText("Row gap"));
    await user.type(screen.getByLabelText("Row gap"), "8");

    expect(sectionOf().layoutByBreakpoint["tablet"]).toBeUndefined();
  });
});

describe("editing a section while desktop is selected", () => {
  it("still writes the desktop value", async () => {
    useEditorStore.setState((state) => ({ ui: { ...state.ui, editingWidth: 1440 } }));
    const user = userEvent.setup();
    const section = asGrid();

    renderWithProviders(<SectionInspector section={section} />);
    await user.clear(screen.getByLabelText("Row gap"));
    await user.type(screen.getByLabelText("Row gap"), "40");

    expect(sectionOf().layoutByBreakpoint["desktop"]).toBeDefined();
    expect(sectionOf().layoutByBreakpoint["mobile"]).toBeUndefined();
  });
});
