import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dashboardApi, type WorkspaceDashboard } from "@/api/dashboard";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { renderWithProviders } from "@/test/render";

vi.mock("@/api/dashboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/dashboard")>()),
  dashboardApi: { load: vi.fn() },
}));

const load = vi.mocked(dashboardApi.load);

function dashboard(overrides: Partial<WorkspaceDashboard> = {}): WorkspaceDashboard {
  return {
    workspaceId: "w1",
    clients: { total: 0, active: 0, needingAttention: 0 },
    sites: { total: 2, withClient: 0, direct: 2 },
    content: { pages: 5, publishedPosts: 0, draftPosts: 0 },
    media: { assets: 0, storageBytes: 0 },
    recentSites: [{ id: "p1", name: "Aurora", slug: "aurora", updatedAt: "2026-08-01T00:00:00.000Z" }],
    recentClients: [],
    traffic: {
      days: 30,
      totalViews: 1234,
      byDay: [{ day: "2026-08-10", views: 1234 }],
      topPages: [{ projectId: "p1", siteName: "Aurora", path: "/about", views: 900 }],
      bySite: [{ projectId: "p1", siteName: "Aurora", views: 1234 }],
    },
    forms: { definitions: 0, submissions: 0, unread: 0, state: "no_forms" },
    ...overrides,
  };
}

beforeEach(() => {
  load.mockReset();
  load.mockResolvedValue(dashboard());
});

describe("DashboardPage", () => {
  it("shows measured totals for the whole account", async () => {
    renderWithProviders(<DashboardPage workspaceId="w1" />);

    // Read from the metric cards, since the same total also appears beside the site it belongs to
    // and "Views" is a column header as well.
    const metrics = await screen.findAllByRole("definition");
    expect(metrics.map((metric) => metric.textContent)).toEqual(["1,234", "2", "5", "—"]);
    expect(screen.getByText("/about")).toBeInTheDocument();
    // Opens on every site, which is the question someone opening a dashboard is asking.
    expect(load).toHaveBeenCalledWith("w1", expect.not.objectContaining({ projectId: expect.anything() }));
  });

  it("says no form exists rather than reporting zero entries", async () => {
    renderWithProviders(<DashboardPage workspaceId="w1" />);

    expect(await screen.findByText("No form has been created yet")).toBeInTheDocument();
    // A dash, not a zero: nothing was measured, so nothing is claimed.
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("reports a real entry count once forms exist", async () => {
    load.mockResolvedValue(
      dashboard({ forms: { definitions: 1, submissions: 42, unread: 3, state: "measured" } }),
    );
    renderWithProviders(<DashboardPage workspaceId="w1" />);

    expect(await screen.findByText("42")).toBeInTheDocument();
    expect(screen.getByText("3 unread")).toBeInTheDocument();
  });

  it("asks the server again when narrowed to one site", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DashboardPage workspaceId="w1" />);

    await user.selectOptions(await screen.findByLabelText("Site"), "p1");

    // Narrowing is a new question, not a filter over what is already loaded: the page ranking for
    // one site is not a subset of the workspace's top ten.
    await waitFor(() => expect(load).toHaveBeenLastCalledWith("w1", expect.objectContaining({ projectId: "p1" })));
  });

  it("changes the window without losing the site filter", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DashboardPage workspaceId="w1" />);

    await user.selectOptions(await screen.findByLabelText("Site"), "p1");
    await user.selectOptions(screen.getByLabelText("Period"), "7");

    await waitFor(() =>
      expect(load).toHaveBeenLastCalledWith("w1", expect.objectContaining({ projectId: "p1", days: 7 })),
    );
  });
});
