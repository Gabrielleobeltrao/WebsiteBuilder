import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AppRoutes } from "@/app/routes";
import { renderWithProviders } from "@/test/render";

describe("PublicShell", () => {
  it("exposes exactly Home and Roadmap as primary navigation", () => {
    renderWithProviders(<AppRoutes />);
    const nav = screen.getAllByRole("navigation", { name: "Main navigation" })[0];
    if (!nav) throw new Error("public navigation is missing");
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Home", "Roadmap"]);
  });

  it("offers login and signup as authentication entry points, not navigation pages", () => {
    renderWithProviders(<AppRoutes />);
    const nav = screen.getAllByRole("navigation", { name: "Main navigation" })[0];
    if (!nav) throw new Error("public navigation is missing");
    expect(within(nav).queryByRole("link", { name: "Log in" })).toBeNull();
    expect(screen.getAllByRole("link", { name: "Log in" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Create account" }).length).toBeGreaterThan(0);
  });

  it("marks the active route for assistive technology", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />);
    await user.click(screen.getAllByRole("link", { name: "Roadmap" })[0]!);
    expect(screen.getAllByRole("link", { name: "Roadmap" })[0]).toHaveAttribute("aria-current", "page");
  });

  it("shows Open dashboard instead of the signup emphasis for a signed-in visitor", () => {
    renderWithProviders(<AppRoutes authenticated />);
    expect(screen.getAllByRole("link", { name: "Open dashboard" }).length).toBeGreaterThan(0);
    // The landing page keeps its own CTAs; only the shell's signup emphasis is replaced.
    const nav = screen.getAllByRole("navigation", { name: "Main navigation" })[0];
    if (!nav) throw new Error("public navigation is missing");
    expect(nav.parentElement?.textContent).not.toContain("Create account");
  });

  it("keeps a skip link as the first focusable element", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />);
    await user.tab();
    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveFocus();
  });

  it("renders one main landmark", () => {
    renderWithProviders(<AppRoutes />);
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });
});

describe("PublicShell mobile drawer", () => {
  it("opens as a modal dialog, traps focus, closes on Escape and restores focus", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />);

    const trigger = screen.getByRole("button", { name: "Open menu" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Main navigation" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("closes after navigating so the drawer never covers the new page", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />);

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const dialog = screen.getByRole("dialog", { name: "Main navigation" });
    await user.click(within(dialog).getByRole("link", { name: "Roadmap" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Product roadmap" })).toBeInTheDocument();
  });
});

describe("shell separation", () => {
  it("sends an unauthenticated /app visitor to login with a validated internal return path", () => {
    renderWithProviders(<AppRoutes />, { route: "/app/w1/sites" });
    expect(screen.getByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
  });

  it("does not treat an /app path as a public marketing page", () => {
    renderWithProviders(<AppRoutes />, { route: "/app/w1/sites" });
    expect(screen.queryByRole("heading", { level: 1, name: "Design the page. Keep the control." })).toBeNull();
  });
});
