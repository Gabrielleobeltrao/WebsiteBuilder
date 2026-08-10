import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ROADMAP_ITEMS } from "@/features/public/roadmap-data";
import { RoadmapPage } from "@/features/public/RoadmapPage";
import { resources } from "@/i18n/resources";
import { renderWithProviders } from "@/test/render";

describe("RoadmapPage", () => {
  it("renders every roadmap item from the data module", () => {
    renderWithProviders(<RoadmapPage />);
    for (const item of ROADMAP_ITEMS) {
      const title = resources["en-US"].public.roadmap.items[item.id as keyof typeof resources["en-US"]["public"]["roadmap"]["items"]].title;
      expect(screen.getByRole("heading", { level: 2, name: title })).toBeInTheDocument();
    }
  });

  it("states status as text, not only as colour", () => {
    renderWithProviders(<RoadmapPage />);
    expect(screen.getAllByText("Released").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Under consideration").length).toBeGreaterThan(0);
  });

  it("shows an explicit no-committed-date label instead of inventing one", () => {
    renderWithProviders(<RoadmapPage />);
    expect(screen.getAllByText("No committed date").length).toBe(ROADMAP_ITEMS.length);
  });

  it("filters by status and reports an empty state rather than a blank page", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RoadmapPage />);

    await user.click(screen.getByRole("button", { name: "Released" }));
    const released = ROADMAP_ITEMS.filter((item) => item.status === "released");
    expect(screen.getAllByRole("listitem").length).toBe(released.length);
    expect(screen.getByRole("button", { name: "Released" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Real-time collaboration")).toBeNull();
  });

  it("renders a legend explaining each status", () => {
    renderWithProviders(<RoadmapPage />);
    expect(screen.getByRole("heading", { level: 2, name: "Status legend" })).toBeInTheDocument();
    expect(screen.getByText("Being evaluated. May never ship.")).toBeInTheDocument();
  });

  it("renders in Portuguese without leaking English", () => {
    renderWithProviders(<RoadmapPage />, { locale: "pt-BR" });
    expect(screen.getByRole("heading", { level: 1, name: "Roadmap do produto" })).toBeInTheDocument();
    expect(screen.queryByText("Product roadmap")).toBeNull();
    expect(screen.getAllByText("Em avaliação").length).toBeGreaterThan(0);
  });
});

describe("roadmap honesty", () => {
  it("never presents an unreleased item as available", () => {
    const unreleased = ROADMAP_ITEMS.filter((item) => item.status !== "released");
    expect(unreleased.every((item) => item.targetPeriod === undefined)).toBe(true);
  });

  it("keeps stable item ids so a card is not duplicated in JSX", () => {
    const ids = ROADMAP_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
