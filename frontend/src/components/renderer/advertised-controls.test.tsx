import { elementDefinition, type BuilderElement, type ElementType } from "@websitebuilder/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ElementRenderer } from "./ElementRenderer";
import { RendererContext, type RendererContextValue } from "./RendererContext";

/**
 * Controls the inspector offers, proved to reach the output.
 *
 * Each of these was a field a designer could fill in and a renderer that never read it: a pricing
 * plan's call to action, its highlight, an announcement bar's link, a site logo's home link. The
 * settings were stored, validated and published, and produced nothing a visitor could see — which
 * is worse than a missing feature, because the product said the work had been done.
 */
const context: RendererContextValue = {
  resolvePagePath: (pageId) => (pageId === "about" ? "/about" : null),
  resolveMediaUrl: () => null,
  homePath: "/",
};

const block = (type: ElementType, overrides: Record<string, unknown>): BuilderElement =>
  ({
    id: `${type}-1`,
    name: "",
    geometry: { x: 0, y: 0, width: 320, height: 80, rotation: 0 },
    responsiveLayout: {
      width: { value: 320, unit: "px" },
      height: { value: 80, unit: "px" },
      horizontalConstraint: "left",
      verticalConstraint: "top",
      visible: true,
    },
    zIndex: 1,
    locked: false,
    hidden: false,
    type,
    version: elementDefinition(type).schemaVersion,
    ...elementDefinition(type).defaults(),
    ...overrides,
  }) as BuilderElement;

const draw = (element: BuilderElement, value: RendererContextValue = context) =>
  render(
    <RendererContext.Provider value={value}>
      <ElementRenderer element={element} />
    </RendererContext.Provider>,
  );

describe("a pricing plan's call to action", () => {
  const plan = (overrides: Record<string, unknown> = {}) => ({
    name: "Pro",
    price: "R$ 99",
    period: "/mês",
    features: ["Everything"],
    highlighted: false,
    link: { kind: "internal", pageId: "about" },
    ctaLabel: "Choose Pro",
    ...overrides,
  });

  it("renders as a link to the page it points at", () => {
    draw(block("pricingTable", { plans: [plan()] }));
    expect(screen.getByRole("link", { name: "Choose Pro" })).toHaveAttribute("href", "/about");
  });

  it("renders as inert text when the page it pointed at is gone", () => {
    draw(block("pricingTable", { plans: [plan({ link: { kind: "internal", pageId: "deleted" } })] }));

    // Never a link to nowhere: a plan whose target was deleted must not send anybody to a 404, and
    // must not silently drop the label the author wrote.
    expect(screen.queryByRole("link", { name: "Choose Pro" })).toBeNull();
    expect(screen.getByText("Choose Pro")).toBeInTheDocument();
  });

  it("offers nothing when the author left the label empty", () => {
    draw(block("pricingTable", { plans: [plan({ ctaLabel: "" })] }));
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("marks the highlighted plan with more than a colour", () => {
    const { container } = draw(block("pricingTable", { plans: [plan({ highlighted: true }), plan({ name: "Basic" })] }));
    const items = Array.from(container.querySelectorAll("li"));

    const highlighted = items.find((item) => item.querySelector("h3")?.textContent === "Pro");
    const plain = items.find((item) => item.querySelector("h3")?.textContent === "Basic");

    expect(highlighted?.style.border).not.toBe(plain?.style.border);
  });
});

describe("an announcement bar", () => {
  it("links the whole announcement when it points somewhere", () => {
    draw(block("announcementBar", { text: "Free shipping", link: { kind: "internal", pageId: "about" } }));
    expect(screen.getByRole("link", { name: "Free shipping" })).toHaveAttribute("href", "/about");
  });

  it("stays plain text when it points nowhere", () => {
    draw(block("announcementBar", { text: "Free shipping", link: { kind: "none" } }));
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Free shipping")).toBeInTheDocument();
  });

  it("refuses a scheme that executes", () => {
    draw(block("announcementBar", { text: "Click", link: { kind: "external", url: "javascript:alert(1)", newTab: false } }));
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("a site logo that links home", () => {
  it("links to the home path its host supplies", () => {
    draw(block("siteLogo", { fallbackText: "Acme", linksHome: true }));
    expect(screen.getByRole("link", { name: "Acme" })).toHaveAttribute("href", "/");
  });

  it("renders unlinked where there is no navigation, rather than linking to nothing", () => {
    // The builder canvas: clicking the logo there must edit it, not navigate away.
    draw(block("siteLogo", { fallbackText: "Acme", linksHome: true }), {
      resolvePagePath: () => null,
      resolveMediaUrl: () => null,
    });

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Acme")).toBeInTheDocument();
  });
});
