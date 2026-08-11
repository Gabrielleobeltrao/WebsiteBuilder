import type { PreflightIssue } from "@websitebuilder/shared";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PublishPanel } from "@/features/publishing/PublishPanel";
import { renderWithProviders } from "@/test/render";

const version = (overrides: Record<string, unknown> = {}) => ({
  id: "v1",
  workspaceId: "w1",
  projectId: "p1",
  version: 1,
  sourceRevision: 4,
  schemaVersion: 1,
  routes: [],
  redirects: [],
  referencedMediaIds: [],
  contentHash: "abc",
  createdByUserId: "u1",
  createdAt: "2026-08-01T10:00:00.000Z",
  ...overrides,
});

/** Routes each request by URL so the panel's three parallel loads can differ per test. */
function mockApi(handlers: {
  issues?: PreflightIssue[];
  sourceRevision?: number;
  versions?: Array<Record<string, unknown>>;
  domains?: Array<Record<string, unknown>>;
  onPublish?: () => Response;
  onRollback?: () => Response;
}) {
  const calls: string[] = [];
  const issues = handlers.issues ?? [];

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify({ data }), { status, headers: { "content-type": "application/json" } });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      calls.push(`${init?.method ?? "GET"} ${path}`);

      if (path.endsWith("/preflight")) {
        return json({
          report: {
            issues,
            blocked: issues.some((issue) => issue.severity === "blocking"),
            routeCount: 1,
            sourceRevision: handlers.sourceRevision ?? 4,
          },
          contentHash: "abc",
        });
      }
      if (path.endsWith("/versions")) return json(handlers.versions ?? []);
      if (path.endsWith("/domains")) return json(handlers.domains ?? []);
      if (path.includes("/rollback")) return handlers.onRollback?.() ?? json(version());
      return handlers.onPublish?.() ?? json({ version: version(), unchanged: false });
    }),
  );

  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("state", () => {
  it("shows the live version and its source revision", async () => {
    mockApi({ versions: [version({ version: 3, sourceRevision: 9 })], sourceRevision: 9 });
    renderWithProviders(<PublishPanel workspaceId="w1" projectId="p1" />);

    expect(await screen.findByText(/Version 3, from revision 9/)).toBeInTheDocument();
  });

  it("says a site has never been published when it has no versions", async () => {
    mockApi({});
    renderWithProviders(<PublishPanel workspaceId="w1" projectId="p1" />);

    expect(await screen.findByText("This site has never been published.")).toBeInTheDocument();
  });

  it("reports unpublished changes when the draft moved past the live version", async () => {
    mockApi({ versions: [version({ sourceRevision: 4 })], sourceRevision: 7 });
    renderWithProviders(<PublishPanel workspaceId="w1" projectId="p1" />);

    expect(await screen.findByText("You have changes that are not online yet.")).toBeInTheDocument();
  });

  it("reports the site as up to date when the live version matches the draft", async () => {
    mockApi({ versions: [version({ sourceRevision: 7 })], sourceRevision: 7 });
    renderWithProviders(<PublishPanel workspaceId="w1" projectId="p1" />);

    expect(await screen.findByText("Everything on this site is online.")).toBeInTheDocument();
  });
});

describe("blockers", () => {
  it("explains each blocker and refuses to publish", async () => {
    mockApi({
      issues: [
        { code: "missing-media", severity: "blocking", detail: "raw server detail" },
        { code: "route-collision", severity: "blocking", detail: "raw", path: "/about" },
      ],
    });
    renderWithProviders(<PublishPanel workspaceId="w1" projectId="p1" />);

    expect(await screen.findByText("An image used on this site no longer exists.")).toBeInTheDocument();
    expect(screen.getByText("Two pages want the same address.")).toBeInTheDocument();
    expect(screen.getByText("/about")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Publish now" })).toBeDisabled());
  });

  it("shows warnings without blocking the button", async () => {
    mockApi({ issues: [{ code: "missing-media", severity: "warning", detail: "raw" }] });
    renderWithProviders(<PublishPanel workspaceId="w1" projectId="p1" />);

    expect(await screen.findByText("Worth knowing")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Publish now" })).toBeEnabled());
  });
});

describe("publishing", () => {
  it("asks for confirmation before anything reaches visitors", async () => {
    const calls = mockApi({});
    renderWithProviders(<PublishPanel workspaceId="w1" projectId="p1" />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Publish now" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Publish now" }));

    expect(screen.getByText("Publish this site?")).toBeInTheDocument();
    // Nothing was sent by opening the dialog.
    expect(calls.some((call) => call.startsWith("POST"))).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "Yes, publish" }));
    expect(await screen.findByText("Your site is online.")).toBeInTheDocument();
  });

  it("says nothing changed rather than claiming a new publication", async () => {
    mockApi({
      onPublish: () =>
        new Response(JSON.stringify({ data: { version: version(), unchanged: true } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    renderWithProviders(<PublishPanel workspaceId="w1" projectId="p1" />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Publish now" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Publish now" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, publish" }));

    expect(await screen.findByText("Nothing changed, so the live version stays as it is.")).toBeInTheDocument();
  });
});

describe("history", () => {
  it("marks the live version and offers restore only for the others", async () => {
    mockApi({ versions: [version({ id: "v2", version: 2 }), version({ id: "v1", version: 1 })] });
    renderWithProviders(<PublishPanel workspaceId="w1" projectId="p1" />);

    expect(await screen.findByText("Live")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Restore" })).toHaveLength(1));
  });

  it("confirms before restoring an older version", async () => {
    const calls = mockApi({ versions: [version({ id: "v2", version: 2 }), version({ id: "v1", version: 1 })] });
    renderWithProviders(<PublishPanel workspaceId="w1" projectId="p1" />);

    await userEvent.click(await screen.findByRole("button", { name: "Restore" }));
    expect(screen.getByText("Restore version 1?")).toBeInTheDocument();
    expect(calls.some((call) => call.includes("/rollback"))).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "Yes, restore" }));
    await waitFor(() => expect(calls.some((call) => call.includes("/rollback"))).toBe(true));
  });
});
