import type { PreflightIssue } from "@websitebuilder/shared";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PublishPanel } from "@/features/publishing/PublishPanel";
import { renderWithProviders } from "@/test/render";

/**
 * Readiness is where responsive findings live now.
 *
 * The clean preview shows the site and nothing else, so this is the surface that has to make a
 * layout problem actionable: what it is, which widths it happens at, and a way to open exactly
 * that element on exactly that device.
 */

const overflow: PreflightIssue = {
  code: "responsive-layout",
  severity: "blocking",
  detail: "This element extends 240px past the right edge of the screen.",
  path: "/about",
  pageId: "page-2",
  elementId: "element-9",
  ranges: [{ from: 320, to: 390 }],
};

const warning: PreflightIssue = {
  code: "responsive-layout",
  severity: "warning",
  detail: "This button is smaller than 44px, which is hard to tap accurately.",
  path: "/",
  pageId: "page-1",
  elementId: "element-3",
  ranges: [{ from: 320, to: 1440 }],
};

function respondWith(issues: PreflightIssue[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("preflight")
        ? {
            data: {
              report: {
                issues,
                blocked: issues.some((issue) => issue.severity === "blocking"),
                routeCount: 2,
                sourceRevision: 4,
              },
              contentHash: null,
            },
          }
        : { data: [] };

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

beforeEach(() => respondWith([overflow, warning]));
afterEach(() => vi.unstubAllGlobals());

const render = () => renderWithProviders(<PublishPanel workspaceId="w1" projectId="p1" />);

describe("responsive findings in the publish flow", () => {
  it("states what is wrong and at which widths", async () => {
    render();

    expect(await screen.findByText(/extends 240px past the right edge/)).toBeInTheDocument();
    expect(screen.getByText(/320–390px/)).toBeInTheDocument();
  });

  it("opens the element on the narrowest device it breaks at", async () => {
    render();

    const links = await screen.findAllByRole("link", { name: "Open in builder" });
    // 320 is a phone, so the builder opens on mobile: the width with the least room, where fixing
    // it usually fixes the wider cases too.
    expect(links[0]).toHaveAttribute("href", "/app/w1/sites/p1/builder/page-2?element=element-9&device=mobile");
  });

  it("offers the same route out of a warning, which does not block", async () => {
    render();

    expect(await screen.findByText(/smaller than 44px/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Open in builder" })).toHaveLength(2);
  });

  it("refuses to publish while a layout error stands", async () => {
    render();

    expect(await screen.findByRole("button", { name: /publish/i })).toBeDisabled();
  });

  it("publishes when only warnings remain", async () => {
    respondWith([warning]);
    render();

    expect(await screen.findByRole("button", { name: /publish/i })).toBeEnabled();
  });
});
