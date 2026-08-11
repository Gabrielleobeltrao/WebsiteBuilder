import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { AuthenticatedAppShell } from "@/app/shells/AuthenticatedAppShell";
import { renderWithProviders } from "@/test/render";

vi.mock("@/api/preferences", () => ({
  workspacesApi: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock("@/features/auth/authClient", () => ({ signOut: vi.fn().mockResolvedValue(undefined) }));

function renderShell() {
  return renderWithProviders(
    <Routes>
      <Route path="/app/:workspaceId" element={<AuthenticatedAppShell />}>
        <Route path="sites" element={<h1>Sites page</h1>} />
        <Route path="media" element={<h1>Media page</h1>} />
      </Route>
    </Routes>,
    { route: "/app/w1/sites" },
  );
}

describe("AuthenticatedAppShell mobile drawer", () => {
  it("keeps the workspace navigation behind one control instead of above the page", async () => {
    const user = userEvent.setup();
    renderShell();

    const trigger = screen.getByRole("button", { name: "Open menu" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    const drawer = screen.getByRole("dialog", { name: "Website Builder" });
    expect(drawer).toHaveAttribute("aria-modal", "true");
    expect(within(drawer).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Sites",
      "Media",
      "Settings",
    ]);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("closes after navigating so the drawer never covers the page it opened", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const drawer = screen.getByRole("dialog", { name: "Website Builder" });
    await user.click(within(drawer).getByRole("link", { name: "Media" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Media page" })).toBeInTheDocument();
  });
});
