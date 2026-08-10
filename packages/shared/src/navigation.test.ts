import { describe, expect, it } from "vitest";

import { resolveSafeLinkHref, type SafeLink } from "./links";
import {
  DEFAULT_NAVIGATION,
  findBrokenNavigationItems,
  navigationConfigSchema,
  resolveNavigation,
  shouldCollapse,
  type NavigationConfig,
} from "./navigation";

const pages: Record<string, string> = { home: "/", about: "/about" };
const resolvePagePath = (pageId: string) => pages[pageId] ?? null;
const resolveLink = (link: SafeLink) => resolveSafeLinkHref(link, { resolvePagePath });

const config = (items: NavigationConfig["items"]): NavigationConfig => ({ ...DEFAULT_NAVIGATION, items });

describe("navigation schema", () => {
  it("accepts typed internal, external and contact destinations", () => {
    const value = config([
      { id: "1", label: "Home", link: { kind: "internal", pageId: "home" } },
      { id: "2", label: "Docs", link: { kind: "external", url: "https://example.com", newTab: true } },
      { id: "3", label: "Email", link: { kind: "email", email: "hi@example.com" } },
    ]);
    expect(navigationConfigSchema.safeParse(value).success).toBe(true);
  });

  it("rejects a dangerous destination", () => {
    const value = config([
      { id: "1", label: "Bad", link: { kind: "external", url: "javascript:alert(1)", newTab: false } },
    ]);
    expect(navigationConfigSchema.safeParse(value).success).toBe(false);
  });

  it("rejects unknown properties and nesting beyond one submenu level", () => {
    expect(
      navigationConfigSchema.safeParse({ ...DEFAULT_NAVIGATION, target: "_blank" }).success,
    ).toBe(false);

    const deep = config([
      {
        id: "1",
        label: "A",
        link: { kind: "none" },
        children: [{ id: "2", label: "B", link: { kind: "none" }, children: [] } as never],
      },
    ]);
    expect(navigationConfigSchema.safeParse(deep).success).toBe(false);
  });
});

describe("resolveNavigation", () => {
  it("resolves internal entries by page id, so a slug change does not break the menu", () => {
    const resolved = resolveNavigation(config([{ id: "1", label: "About", link: { kind: "internal", pageId: "about" } }]), {
      resolvePagePath,
      resolveLink,
    });
    expect(resolved[0]?.href).toBe("/about");
  });

  it("keeps a broken entry visible with no href rather than dropping it", () => {
    const resolved = resolveNavigation(
      config([{ id: "1", label: "Gone", link: { kind: "internal", pageId: "deleted" } }]),
      { resolvePagePath, resolveLink },
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.label).toBe("Gone");
    expect(resolved[0]?.href).toBeNull();
  });

  it("never produces an href for a dangerous stored destination", () => {
    const resolved = resolveNavigation(
      config([{ id: "1", label: "Bad", link: { kind: "external", url: "javascript:alert(1)", newTab: false } }]),
      { resolvePagePath, resolveLink },
    );
    expect(resolved[0]?.href).toBeNull();
  });

  it("marks the entry for the page being viewed as current", () => {
    const resolved = resolveNavigation(
      config([
        { id: "1", label: "Home", link: { kind: "internal", pageId: "home" } },
        { id: "2", label: "About", link: { kind: "internal", pageId: "about" } },
      ]),
      { resolvePagePath, resolveLink, currentPath: "/about" },
    );

    expect(resolved[0]?.current).toBe(false);
    expect(resolved[1]?.current).toBe(true);
  });

  it("carries new-tab safety attributes through", () => {
    const resolved = resolveNavigation(
      config([{ id: "1", label: "Docs", link: { kind: "external", url: "https://example.com", newTab: true } }]),
      { resolvePagePath, resolveLink },
    );
    expect(resolved[0]?.target).toBe("_blank");
    expect(resolved[0]?.rel).toBe("noopener noreferrer");
  });

  it("resolves submenu entries too", () => {
    const resolved = resolveNavigation(
      config([
        {
          id: "1",
          label: "More",
          link: { kind: "none" },
          children: [{ id: "2", label: "About", link: { kind: "internal", pageId: "about" } }],
        },
      ]),
      { resolvePagePath, resolveLink },
    );

    expect(resolved[0]?.href).toBeNull();
    expect(resolved[0]?.children[0]?.href).toBe("/about");
  });
});

describe("findBrokenNavigationItems", () => {
  it("reports broken entries at any level so the editor can flag them", () => {
    const resolved = resolveNavigation(
      config([
        { id: "1", label: "Ok", link: { kind: "internal", pageId: "home" } },
        {
          id: "2",
          label: "Parent",
          link: { kind: "internal", pageId: "home" },
          children: [{ id: "3", label: "Gone", link: { kind: "internal", pageId: "deleted" } }],
        },
      ]),
      { resolvePagePath, resolveLink },
    );

    expect(findBrokenNavigationItems(resolved).map((item) => item.label)).toEqual(["Gone"]);
  });
});

describe("shouldCollapse", () => {
  it("collapses below the configured width and not at or above it", () => {
    expect(shouldCollapse({ collapseBelow: 768 }, 767)).toBe(true);
    expect(shouldCollapse({ collapseBelow: 768 }, 768)).toBe(false);
    expect(shouldCollapse({ collapseBelow: 768 }, 1440)).toBe(false);
  });
});
