import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { LandingPage } from "@/features/public/LandingPage";
import { renderWithProviders } from "@/test/render";

describe("LandingPage", () => {
  it("has exactly one h1 and an ordered heading structure", () => {
    renderWithProviders(<LandingPage />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);

    const levels = screen
      .getAllByRole("heading")
      .map((heading) => Number(heading.tagName.replace("H", "")));
    for (const [index, level] of levels.entries()) {
      const previous = levels[index - 1];
      if (previous !== undefined) expect(level - previous).toBeLessThanOrEqual(1);
    }
  });

  it("presents the required sections in order", () => {
    renderWithProviders(<LandingPage />);
    const titles = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(titles).toEqual([
      "One canvas, two ways to work",
      "Built for work that ships",
      "What is in the product",
      "Two ways to use it",
      "Three steps",
      "Where the product is going",
      "Questions",
      "Build the first page",
    ]);
  });

  it("labels every section for assistive technology", () => {
    const { container } = renderWithProviders(<LandingPage />);
    const sections = container.querySelectorAll("section");
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) expect(section).toHaveAttribute("aria-labelledby");
  });

  it("offers a primary call to action and a roadmap link", () => {
    renderWithProviders(<LandingPage />);
    expect(screen.getByRole("link", { name: "Start building" })).toHaveAttribute("href", "/signup");
    expect(screen.getByRole("link", { name: "See the roadmap" })).toHaveAttribute("href", "/roadmap");
  });

  it("shows roadmap preview items with an honest status label", () => {
    renderWithProviders(<LandingPage />);
    const preview = screen.getByRole("heading", { level: 2, name: "Where the product is going" }).closest("section");
    if (!preview) throw new Error("roadmap preview section is missing");
    expect(within(preview).getAllByText(/Released|In progress/).length).toBeGreaterThan(0);
  });

  it("keeps FAQ answers keyboard reachable through native disclosure", async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<LandingPage />);
    const details = container.querySelectorAll("details");
    expect(details.length).toBe(4);

    const first = details[0];
    if (!first) throw new Error("FAQ is missing");
    expect(first.open).toBe(false);
    await user.click(within(first).getByText("Can I paste custom HTML, CSS or JavaScript?"));
    expect(first.open).toBe(true);
  });

  it("renders fully in Portuguese", () => {
    renderWithProviders(<LandingPage />, { locale: "pt-BR" });
    expect(screen.getByRole("heading", { level: 1, name: "Desenhe a página. Mantenha o controle." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Começar a criar" })).toBeInTheDocument();
    expect(screen.queryByText("Start building")).toBeNull();
  });

  it("does not describe a planned feature as already available", () => {
    renderWithProviders(<LandingPage />);
    const exportAnswer = screen.getByText(/A static export path is planned but not available yet/);
    expect(exportAnswer).toBeInTheDocument();
  });
});
