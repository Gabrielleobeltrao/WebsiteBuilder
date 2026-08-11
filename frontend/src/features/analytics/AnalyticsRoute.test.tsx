import { DEFAULT_ANALYTICS_SETTINGS } from "@websitebuilder/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { analyticsApi } from "@/api/analytics";
import { AnalyticsRoute } from "@/features/analytics/AnalyticsRoute";
import { renderWithProviders } from "@/test/render";

vi.mock("@/api/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/analytics")>()),
  analyticsApi: {
    loadSettings: vi.fn(),
    saveSettings: vi.fn(),
    overview: vi.fn(),
    pages: vi.fn(),
    vitals: vi.fn(),
    deleteData: vi.fn(),
    exportUrl: vi.fn().mockReturnValue("/api/v1/export.csv"),
  },
}));

const api = vi.mocked(analyticsApi);

const overview = (overrides: Record<string, unknown> = {}) => ({
  days: 30,
  from: "2026-07-13",
  to: "2026-08-11",
  serverViews: 100,
  browserViews: 60,
  sessions: 40,
  engagedSessions: 20,
  bounces: 20,
  engagedMs: 400_000,
  clicks: 12,
  byDay: [{ day: "2026-08-11", sessions: 40, views: 60 }],
  byDevice: [{ device: "mobile", sessions: 40 }],
  bySource: [{ source: "direct", sessions: 40 }],
  byHost: [{ host: "site.example.test", sessions: 40 }],
  comparison: { sessions: 30, browserViews: 0 },
  ...overrides,
});

function renderRoute(route = "/app/w1/sites/p1/analytics") {
  return renderWithProviders(
    <Routes>
      <Route path="/app/:workspaceId/sites/:projectId/analytics" element={<AnalyticsRoute />} />
    </Routes>,
    { route },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.loadSettings.mockResolvedValue({ ...DEFAULT_ANALYTICS_SETTINGS, enabled: true });
  api.overview.mockResolvedValue(overview() as never);
  api.pages.mockResolvedValue({ pages: [] } as never);
  api.vitals.mockResolvedValue({ metrics: [], minimumSamples: 50 } as never);
  api.exportUrl.mockReturnValue("/api/v1/export.csv");
});

describe("a site that is not collecting", () => {
  it("explains itself instead of showing an empty chart", async () => {
    api.loadSettings.mockResolvedValue({ ...DEFAULT_ANALYTICS_SETTINGS, enabled: false });
    renderRoute();

    expect(await screen.findByText("Analytics is off for this site")).toBeInTheDocument();
    // A zero and "nobody is counting" look identical on a dashboard and mean opposite things.
    expect(api.overview).not.toHaveBeenCalled();
  });

  it("offers the way to turn it on", async () => {
    const user = userEvent.setup();
    api.loadSettings.mockResolvedValue({ ...DEFAULT_ANALYTICS_SETTINGS, enabled: false });
    renderRoute();

    await user.click(await screen.findByRole("button", { name: "Open settings" }));

    expect(await screen.findByLabelText("Measure this site")).toBeInTheDocument();
  });
});

describe("the overview", () => {
  it("shows both view counts and the coverage between them", async () => {
    renderRoute();

    const server = await screen.findByText("Views counted by the server");
    expect(within(server.closest("div") as HTMLElement).getByText("100")).toBeInTheDocument();

    const browser = screen.getByText("Views measured in the browser");
    const card = browser.closest("div") as HTMLElement;
    expect(within(card).getByText("60")).toBeInTheDocument();
    // 60 of 100: the share of visits the tracker actually measured.
    expect(within(card).getByText(/60%/)).toBeInTheDocument();
  });

  it("says when there is no comparable previous period", async () => {
    api.overview.mockResolvedValue(overview({ comparison: null }) as never);
    renderRoute();

    expect(await screen.findByText("No comparable previous period")).toBeInTheDocument();
  });

  it("waits for visitors rather than reporting a measured nothing", async () => {
    api.overview.mockResolvedValue(overview({ sessions: 0, serverViews: 0, browserViews: 0 }) as never);
    renderRoute();

    expect(await screen.findByText("Waiting for visitors")).toBeInTheDocument();
  });
});

describe("filters", () => {
  it("keeps its state in the address, so a view can be shared", async () => {
    const user = userEvent.setup();
    renderRoute();

    await user.selectOptions(await screen.findByLabelText("Period"), "7");

    // The filter is read back out of the address on the next render, which is what makes a view
    // reloadable and shareable — asserted through the request it produces, since the test router
    // keeps its history in memory rather than in the browser's address bar.
    await waitFor(() =>
      expect(api.overview).toHaveBeenLastCalledWith("w1", "p1", expect.objectContaining({ days: 7 }), expect.anything()),
    );
  });

  it("reads its state back from the address", async () => {
    renderRoute("/app/w1/sites/p1/analytics?tab=pages&days=90&device=mobile");

    await waitFor(() =>
      expect(api.pages).toHaveBeenCalledWith("w1", "p1", { days: 90, device: "mobile" }, expect.anything()),
    );
  });

  it("ignores a window nobody offers rather than asking for it", async () => {
    renderRoute("/app/w1/sites/p1/analytics?days=100000");

    await waitFor(() =>
      expect(api.overview).toHaveBeenCalledWith("w1", "p1", expect.objectContaining({ days: 30 }), expect.anything()),
    );
  });
});

describe("technical performance", () => {
  it("shows a sample count and no rating below the threshold", async () => {
    api.vitals.mockResolvedValue({
      metrics: [{ metric: "LCP", device: "mobile", samples: 3, p75: null, rating: null }],
      minimumSamples: 50,
    } as never);
    renderRoute("/app/w1/sites/p1/analytics?tab=vitals");

    expect(await screen.findByText("Not enough samples yet (3 of 50)")).toBeInTheDocument();
    expect(screen.queryByText("Good")).toBeNull();
  });

  it("names the rating in words, not only in colour", async () => {
    api.vitals.mockResolvedValue({
      metrics: [{ metric: "LCP", device: "mobile", samples: 500, p75: 2000, rating: "good" }],
      minimumSamples: 50,
    } as never);
    renderRoute("/app/w1/sites/p1/analytics?tab=vitals");

    expect(await screen.findByText("Good")).toBeInTheDocument();
  });
});

describe("settings", () => {
  it("saves what was changed", async () => {
    const user = userEvent.setup();
    api.saveSettings.mockResolvedValue({ ...DEFAULT_ANALYTICS_SETTINGS, enabled: true, consentRequired: false });
    renderRoute("/app/w1/sites/p1/analytics?tab=settings");

    await user.click(await screen.findByLabelText("Ask visitors before measuring"));
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith("w1", "p1", expect.objectContaining({ consentRequired: false })),
    );
  });

  it("asks before destroying anything", async () => {
    const user = userEvent.setup();
    renderRoute("/app/w1/sites/p1/analytics?tab=settings");

    await user.click(await screen.findByRole("button", { name: "Delete analytics" }));

    // Confirmed in a dialog, not on the click that opened it.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(api.deleteData).not.toHaveBeenCalled();
  });
});
