import type { AuditCategory, CategoryResult, Finding } from "@websitebuilder/shared";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ReadinessPanel } from "@/features/sites/ReadinessPanel";
import { renderWithProviders } from "@/test/render";

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  code: "overflow",
  severity: "error",
  path: "/",
  detail: "This element runs off the screen.",
  ...overrides,
});

const checked = (findings: Finding[] = [], sourceRevision = 5): CategoryResult => ({
  status: "checked",
  findings,
  checkedAt: "2026-08-10T10:00:00.000Z",
  sourceRevision,
});

const all = (findings: Finding[] = []): Partial<Record<AuditCategory, CategoryResult>> => ({
  layout: checked(findings),
  accessibility: checked(),
  links: checked(),
  content: checked(),
  performance: checked(),
});

describe("not checked", () => {
  it("says so rather than showing a category as clean", () => {
    // A dashboard that reads green because a check never ran is worse than one showing nothing.
    renderWithProviders(<ReadinessPanel categories={{}} currentRevision={5} />);

    expect(screen.getAllByText("Not checked")).toHaveLength(5);
    expect(screen.getByRole("status")).toHaveTextContent("Some things still need attention.");
  });

  it("explains why that is not the same as clean", () => {
    renderWithProviders(<ReadinessPanel categories={{}} currentRevision={5} />);
    expect(screen.getAllByText(/Nothing found is not the same as nothing wrong/)[0]).toBeInTheDocument();
  });

  it("reports everything in order only when every category ran clean", () => {
    renderWithProviders(<ReadinessPanel categories={all()} currentRevision={5} />);
    expect(screen.getByRole("status")).toHaveTextContent("Everything checked is in order.");
  });
});

describe("stale results", () => {
  it("marks a result from before the last change", () => {
    renderWithProviders(<ReadinessPanel categories={{ layout: checked([], 4) }} currentRevision={5} />);

    expect(screen.getByText("Out of date")).toBeInTheDocument();
    expect(screen.getByText(/may no longer be accurate/)).toBeInTheDocument();
  });

  it("still shows what that result found", () => {
    renderWithProviders(
      <ReadinessPanel categories={{ layout: checked([finding()], 4) }} currentRevision={5} />,
    );

    expect(screen.getByText("This element runs off the screen.")).toBeInTheDocument();
  });
});

describe("filters", () => {
  it("narrows to one severity and back", async () => {
    const findings = [finding(), finding({ severity: "warning", detail: "Text is small." })];
    renderWithProviders(<ReadinessPanel categories={all(findings)} currentRevision={5} />);

    await userEvent.click(screen.getByRole("button", { name: "Blocking" }));
    expect(screen.getByText("This element runs off the screen.")).toBeInTheDocument();
    expect(screen.queryByText("Text is small.")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("Text is small.")).toBeInTheDocument();
  });
});

describe("width ranges", () => {
  it("shows the widths a layout finding applies at", () => {
    const responsive = { ...finding(), ranges: [{ from: 320, to: 640 }] };
    renderWithProviders(<ReadinessPanel categories={{ layout: checked([responsive]) }} currentRevision={5} />);

    expect(screen.getByText(/320–640px/)).toBeInTheDocument();
  });

  it("says nothing about widths for an audit that has none", () => {
    renderWithProviders(<ReadinessPanel categories={{ links: checked([finding()]) }} currentRevision={5} />);
    expect(screen.queryByText(/Affects/)).not.toBeInTheDocument();
  });
});

describe("rerun", () => {
  it("offers a rerun and reports while it runs", async () => {
    const onRerun = vi.fn();
    const { rerender } = renderWithProviders(
      <ReadinessPanel categories={all()} currentRevision={5} onRerun={onRerun} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(onRerun).toHaveBeenCalled();

    rerender(<ReadinessPanel categories={all()} currentRevision={5} onRerun={onRerun} busy />);
    expect(screen.getByRole("button", { name: "Checking…" })).toBeDisabled();
  });
});
