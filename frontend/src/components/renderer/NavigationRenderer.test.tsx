import { DEFAULT_NAVIGATION, type NavigationConfig } from "@websitebuilder/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { NavigationRenderer } from "./NavigationRenderer";
import { RendererContext, type RendererContextValue } from "./RendererContext";

const pages: Record<string, string> = { home: "/", about: "/about" };
const context: RendererContextValue = {
  resolvePagePath: (pageId) => pages[pageId] ?? null,
  resolveMediaUrl: () => null,
};

const config = (items: NavigationConfig["items"], overrides: Partial<NavigationConfig> = {}): NavigationConfig => ({
  ...DEFAULT_NAVIGATION,
  items,
  ...overrides,
});

function renderMenu(value: NavigationConfig, width = 1440, currentPath?: string) {
  return render(
    <RendererContext.Provider value={context}>
      <NavigationRenderer
        config={value}
        containerWidth={width}
        {...(currentPath ? { currentPath } : {})}
        menuLabel="Site navigation"
        toggleLabel="Open menu"
      />
    </RendererContext.Provider>,
  );
}

const items = [
  { id: "1", label: "Home", link: { kind: "internal" as const, pageId: "home" } },
  { id: "2", label: "About", link: { kind: "internal" as const, pageId: "about" } },
];

describe("wide layout", () => {
  it("renders every destination as a link", () => {
    renderMenu(config(items));
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
    expect(screen.queryByRole("button", { name: "Open menu" })).toBeNull();
  });

  it("announces the current page", () => {
    renderMenu(config(items), 1440, "/about");
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("survives a page whose slug changed, because entries reference an id", () => {
    // The path behind "about" changes; the menu entry still resolves.
    const moved: RendererContextValue = { ...context, resolvePagePath: (id) => (id === "about" ? "/sobre" : null) };
    render(
      <RendererContext.Provider value={moved}>
        <NavigationRenderer
          config={config(items)}
          containerWidth={1440}
          menuLabel="Site navigation"
          toggleLabel="Open menu"
        />
      </RendererContext.Provider>,
    );
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "/sobre");
  });

  it("keeps a broken entry visible as plain text rather than dropping it", () => {
    renderMenu(config([{ id: "1", label: "Gone", link: { kind: "internal", pageId: "deleted" } }]));
    expect(screen.queryByRole("link", { name: "Gone" })).toBeNull();
    expect(screen.getByText("Gone")).toBeInTheDocument();
  });

  it("never renders an href for a dangerous destination", () => {
    renderMenu(config([{ id: "1", label: "Bad", link: { kind: "external", url: "javascript:alert(1)", newTab: false } }]));
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("adds new-tab safety attributes", () => {
    renderMenu(config([{ id: "1", label: "Docs", link: { kind: "external", url: "https://example.com", newTab: true } }]));
    const link = screen.getByRole("link", { name: "Docs" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders one submenu level", () => {
    renderMenu(
      config([
        {
          id: "1",
          label: "More",
          link: { kind: "none" },
          children: [{ id: "2", label: "About", link: { kind: "internal", pageId: "about" } }],
        },
      ]),
    );
    expect(screen.getByRole("link", { name: "About" })).toBeInTheDocument();
  });
});

describe("collapsed layout", () => {
  it("becomes a disclosure below the configured width", async () => {
    const user = userEvent.setup();
    renderMenu(config(items, { collapseBelow: 768 }), 390);

    const toggle = screen.getByRole("button", { name: "Open menu" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(screen.getByRole("navigation")).getByRole("link", { name: "Home" })).toBeInTheDocument();
  });

  it("stays expanded at exactly the collapse width", () => {
    renderMenu(config(items, { collapseBelow: 768 }), 768);
    expect(screen.queryByRole("button", { name: "Open menu" })).toBeNull();
  });

  it("controls the list it discloses", async () => {
    const user = userEvent.setup();
    renderMenu(config(items, { collapseBelow: 768 }), 390);

    const toggle = screen.getByRole("button", { name: "Open menu" });
    await user.click(toggle);
    expect(document.getElementById(toggle.getAttribute("aria-controls") ?? "")).not.toBeNull();
  });
});
