import type { CmsCollectionElement, QueryableItem } from "@websitebuilder/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { CmsCollectionRenderer } from "./CmsCollectionRenderer";
import { RendererContext, type RendererContextValue } from "./RendererContext";

const context: RendererContextValue = {
  resolvePagePath: () => null,
  resolveMediaUrl: (mediaId) => `/media/${mediaId}`,
};

const element = (overrides: Partial<CmsCollectionElement> = {}): CmsCollectionElement =>
  ({
    id: "el-1",
    name: "Projects",
    type: "cmsCollection",
    geometry: { x: 0, y: 0, width: 800, height: 400, rotation: 0 },
    responsiveLayout: {
      width: { value: 800, unit: "px" },
      height: { value: 400, unit: "px" },
      horizontalConstraint: "left",
      verticalConstraint: "top",
      visible: true,
    },
    zIndex: 1,
    locked: false,
    hidden: false,
    query: { collectionId: "c1", filters: [], sort: "newest", limit: 2, paginate: true },
    layout: "grid",
    columns: 3,
    gap: 16,
    cardFields: [{ fieldId: "f-title", display: "heading" }],
    emptyStateText: "Nothing here yet.",
    loadMoreText: "Show more",
    linkToDetail: true,
    ...overrides,
  }) as CmsCollectionElement;

const item = (id: string, overrides: Partial<QueryableItem> = {}): QueryableItem => ({
  id,
  collectionId: "c1",
  slug: id,
  status: "published",
  values: { "f-title": `Item ${id}` },
  publishedAt: `2026-01-0${id}T00:00:00.000Z`,
  updatedAt: `2026-01-0${id}T00:00:00.000Z`,
  ...overrides,
});

const renderList = (props: Partial<Parameters<typeof CmsCollectionRenderer>[0]> = {}) =>
  render(
    <RendererContext.Provider value={context}>
      <CmsCollectionRenderer element={element()} items={[]} collectionSlug="projects" {...props} />
    </RendererContext.Provider>,
  );

describe("empty state", () => {
  it("shows the editable message rather than an empty page", () => {
    renderList();
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });

  it("shows it when every matching item is a draft", () => {
    renderList({ items: [item("1", { status: "draft" })] });
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });
});

describe("cards", () => {
  it("renders one card per matching item", () => {
    renderList({ items: [item("1"), item("2")] });
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("links each card to the item's own page", () => {
    renderList({ items: [item("1")] });
    expect(screen.getByRole("link")).toHaveAttribute("href", "/projects/1");
  });

  it("does not link when the collection has no detail page", () => {
    renderList({ element: element({ linkToDetail: false }), items: [item("1")] });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders nothing for a field the item never filled", () => {
    // An empty slot is a signal; the string "undefined" on a customer's page is a lie.
    renderList({ items: [item("1", { values: {} })] });
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });

  it("refuses to make a non-http value clickable", () => {
    // linkToDetail off so the only link that could appear is the field's own.
    const withLink = element({ linkToDetail: false, cardFields: [{ fieldId: "f-url", display: "link" }] });
    renderList({ element: withLink, items: [item("1", { values: { "f-url": "javascript:alert(1)" } })] });

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("javascript:alert(1)")).toBeInTheDocument();
  });
});

describe("pagination", () => {
  it("shows more items on request without leaving the page", async () => {
    renderList({ items: [item("1"), item("2"), item("3")] });

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Show more" }));

    // Earlier items stay: the control says "show more", not "next page".
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("hides the control when nothing more matches", () => {
    renderList({ items: [item("1")] });
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });
});

describe("publishing", () => {
  it("adds a newly published item without the page being edited", () => {
    const { rerender } = renderList({ items: [item("1")] });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);

    rerender(
      <RendererContext.Provider value={context}>
        <CmsCollectionRenderer element={element()} items={[item("1"), item("2")]} collectionSlug="projects" />
      </RendererContext.Provider>,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
