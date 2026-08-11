import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PreviewWidthControl } from "@/features/preview/PreviewWidthControl";
import { renderWithProviders } from "@/test/render";

describe("presets", () => {
  it("marks the preset matching the current width", () => {
    renderWithProviders(<PreviewWidthControl width={390} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "390" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "1440" })).toHaveAttribute("aria-pressed", "false");
  });

  it("selects a preset width", async () => {
    const onChange = vi.fn();
    renderWithProviders(<PreviewWidthControl width={1440} onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "768" }));
    expect(onChange).toHaveBeenCalledWith(768);
  });
});

describe("exact width", () => {
  it("can be cleared and retyped", async () => {
    // A controlled numeric field that clamps on every keystroke makes this impossible: the old
    // value stays, the next digit appends, and the field fights the person using it.
    const onChange = vi.fn();
    renderWithProviders(<PreviewWidthControl width={1440} onChange={onChange} />);

    const field = screen.getByLabelText("Exact width in pixels");
    await userEvent.clear(field);
    await userEvent.type(field, "834");
    await userEvent.tab();

    expect(onChange).toHaveBeenLastCalledWith(834);
  });

  it("clamps a width outside the range the sweep covers", async () => {
    const onChange = vi.fn();
    renderWithProviders(<PreviewWidthControl width={1440} onChange={onChange} />);

    const field = screen.getByLabelText("Exact width in pixels");
    await userEvent.clear(field);
    await userEvent.type(field, "5000");
    await userEvent.tab();

    expect(onChange).toHaveBeenLastCalledWith(1920);
  });

  it("reverts an unparseable draft rather than guessing", async () => {
    const onChange = vi.fn();
    renderWithProviders(<PreviewWidthControl width={1024} onChange={onChange} />);

    const field = screen.getByLabelText("Exact width in pixels");
    await userEvent.clear(field);
    await userEvent.tab();

    expect(onChange).toHaveBeenLastCalledWith(1024);
  });

  it("moves with the slider", async () => {
    const onChange = vi.fn();
    renderWithProviders(<PreviewWidthControl width={1024} onChange={onChange} />);

    const slider = screen.getByLabelText("Preview width");
    expect(slider).toHaveAttribute("min", "320");
    expect(slider).toHaveAttribute("max", "1920");
  });
});
