import { createDefaultSiteSeo, resolveMetadata, type SiteSeoSettings } from "@websitebuilder/shared";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SiteSeoSettingsForm } from "@/features/seo/SiteSeoSettingsForm";
import { renderWithProviders } from "@/test/render";

const settings = (overrides: Partial<SiteSeoSettings> = {}): SiteSeoSettings => ({
  ...createDefaultSiteSeo("Acme"),
  ...overrides,
});

describe("site SEO settings", () => {
  it("labels every field", () => {
    renderWithProviders(<SiteSeoSettingsForm value={settings()} onSave={vi.fn()} />);

    expect(screen.getByLabelText("Site name")).toBeInTheDocument();
    expect(screen.getByLabelText("Title template")).toBeInTheDocument();
    expect(screen.getByLabelText("Default description")).toBeInTheDocument();
    expect(screen.getByLabelText("Canonical base URL")).toBeInTheDocument();
    expect(screen.getByLabelText("Site language")).toBeInTheDocument();
  });

  it("explains that the site language describes the published site, not the interface", () => {
    renderWithProviders(<SiteSeoSettingsForm value={settings()} onSave={vi.fn()} />);
    expect(screen.getByText(/language of the published website, not of this interface/)).toBeInTheDocument();
  });

  it("saves valid settings", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithProviders(<SiteSeoSettingsForm value={settings()} onSave={onSave} />);

    await user.clear(screen.getByLabelText("Site name"));
    await user.type(screen.getByLabelText("Site name"), "Acme Studio");
    await user.click(screen.getByRole("button", { name: "Save SEO settings" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ siteName: "Acme Studio" }));
    expect(await screen.findByRole("status")).toHaveTextContent("SEO settings saved");
  });

  it("refuses an invalid canonical URL instead of sending it", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<SiteSeoSettingsForm value={settings()} onSave={onSave} />);

    await user.type(screen.getByLabelText("Canonical base URL"), "not a url");
    await user.click(screen.getByRole("button", { name: "Save SEO settings" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Check the canonical URL.");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("states why omitting the canonical base is safer than guessing", () => {
    renderWithProviders(<SiteSeoSettingsForm value={settings()} onSave={vi.fn()} />);
    expect(screen.getByText(/Guessing one is worse than omitting it/)).toBeInTheDocument();
  });

  it("toggles the default robots directives independently", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithProviders(<SiteSeoSettingsForm value={settings()} onSave={onSave} />);

    await user.click(screen.getByLabelText("Allow search engines to index this page"));
    await user.click(screen.getByRole("button", { name: "Save SEO settings" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ defaultRobots: { index: false, follow: true } }),
    );
  });

  it("changing a default does not erase a page override, because they resolve separately", () => {
    // The form edits site defaults only; a page's own title still wins in the resolver.
    const resolved = resolveMetadata({
      site: settings({ defaultDescription: "New site default" }),
      page: { title: "Page title", description: "Page description", robots: { index: true, follow: true } },
      fallbackTitle: "Page",
      path: "/page",
    });
    expect(resolved.description).toBe("Page description");
  });

  it("makes no ranking promise", () => {
    renderWithProviders(<SiteSeoSettingsForm value={settings()} onSave={vi.fn()} />);
    expect(screen.getByText(/do not predict search ranking/)).toBeInTheDocument();
  });

  it("renders in Portuguese", () => {
    renderWithProviders(<SiteSeoSettingsForm value={settings()} onSave={vi.fn()} />, { locale: "pt-BR" });
    expect(screen.getByLabelText("Nome do site")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar configurações de SEO" })).toBeInTheDocument();
  });
});
