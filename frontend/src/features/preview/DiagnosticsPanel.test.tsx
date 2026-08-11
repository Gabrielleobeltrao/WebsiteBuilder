import type { ResponsiveFinding } from "@websitebuilder/shared";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DiagnosticsPanel } from "@/features/preview/DiagnosticsPanel";
import { renderWithProviders } from "@/test/render";

const finding = (overrides: Partial<ResponsiveFinding> = {}): ResponsiveFinding => ({
  code: "overflow",
  severity: "error",
  path: "/",
  elementId: "e1",
  detail: "This element extends 480px past the right edge of the screen.",
  ranges: [{ from: 320, to: 640 }],
  ...overrides,
});

describe("reporting", () => {
  it("says plainly when nothing is wrong", () => {
    renderWithProviders(<DiagnosticsPanel findings={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("No layout problems found at any width.");
  });

  it("names the widths a problem applies at", () => {
    renderWithProviders(<DiagnosticsPanel findings={[finding()]} />);
    expect(screen.getByText("320–640px")).toBeInTheDocument();
  });

  it("shows a single affected width without a range", () => {
    renderWithProviders(<DiagnosticsPanel findings={[finding({ ranges: [{ from: 320, to: 320 }] })]} />);
    expect(screen.getByText("320px")).toBeInTheDocument();
  });

  it("puts breaking problems before things to check", () => {
    renderWithProviders(
      <DiagnosticsPanel
        findings={[
          finding({ code: "small-text", severity: "warning", elementId: "e2", detail: "Text is small." }),
          finding({ detail: "Element overflows." }),
        ]}
      />,
    );

    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Element overflows.");
  });

  it("links a finding to its element", async () => {
    const onSelect = vi.fn();
    renderWithProviders(<DiagnosticsPanel findings={[finding()]} onSelect={onSelect} />);

    await userEvent.click(screen.getByRole("button", { name: /extends 480px/ }));
    expect(onSelect).toHaveBeenCalledWith("e1");
  });

  it("changes nothing on its own", async () => {
    // The panel reports; it never repositions an element to clear a warning.
    const findings = [finding()];
    const snapshot = structuredClone(findings);

    renderWithProviders(<DiagnosticsPanel findings={findings} />);
    await userEvent.click(screen.getByRole("button", { name: /extends 480px/ }));

    expect(findings).toEqual(snapshot);
  });
});
