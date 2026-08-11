import type { SiteDomain } from "@websitebuilder/shared";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DomainsPanel } from "@/features/publishing/DomainsPanel";
import { renderWithProviders } from "@/test/render";

const domain = (overrides: Partial<SiteDomain> = {}): SiteDomain => ({
  id: "d1",
  workspaceId: "w1",
  projectId: "p1",
  hostname: "acme.platform.test",
  kind: "platform",
  status: "active",
  isPrimary: true,
  provider: "platform_wildcard",
  sslStatus: "active",
  createdAt: "2026-08-01T10:00:00.000Z",
  ...overrides,
});

function mockApi(domains: SiteDomain[], overrides: { onConnect?: () => Response } = {}) {
  const calls: string[] = [];
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify({ data }), { status, headers: { "content-type": "application/json" } });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${path}`);

      if (method === "GET") return json(domains);
      if (path.endsWith("/domains/custom")) {
        return overrides.onConnect?.() ?? json({ domain: domain({ kind: "custom" }), providerReachable: true });
      }
      if (method === "DELETE") return new Response(null, { status: 204 });
      return json(domains[0] ?? domain());
    }),
  );

  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("addresses", () => {
  it("separates the free address from customer domains", async () => {
    mockApi([domain(), domain({ id: "d2", hostname: "www.customer.test", kind: "custom" })]);
    renderWithProviders(<DomainsPanel workspaceId="w1" projectId="p1" />);

    expect(await screen.findByText("acme.platform.test")).toBeInTheDocument();
    expect(screen.getByText("www.customer.test")).toBeInTheDocument();
    expect(screen.getByText("This address always works and cannot be removed.")).toBeInTheDocument();
  });

  it("does not offer to disconnect the free address", async () => {
    mockApi([domain()]);
    renderWithProviders(<DomainsPanel workspaceId="w1" projectId="p1" />);

    await screen.findByText("acme.platform.test");
    expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
  });
});

describe("status", () => {
  it("reports a pending domain honestly rather than as working", async () => {
    mockApi([
      domain({
        id: "d2",
        hostname: "www.customer.test",
        kind: "custom",
        status: "pending_dns",
        sslStatus: "pending",
        isPrimary: false,
        verification: { method: "cname", name: "www.customer.test", value: "origin.platform.test" },
      }),
    ]);
    renderWithProviders(<DomainsPanel workspaceId="w1" projectId="p1" />);

    expect(await screen.findByText("Waiting for your DNS record")).toBeInTheDocument();
    expect(screen.queryByText("Working")).not.toBeInTheDocument();
  });

  it("shows the exact DNS record while a domain is not live", async () => {
    mockApi([
      domain({
        id: "d2",
        hostname: "www.customer.test",
        kind: "custom",
        status: "pending_dns",
        sslStatus: "pending",
        isPrimary: false,
        verification: { method: "txt", name: "_cf.www.customer.test", value: "verify-me" },
      }),
    ]);
    renderWithProviders(<DomainsPanel workspaceId="w1" projectId="p1" />);

    expect(await screen.findByText("_cf.www.customer.test")).toBeInTheDocument();
    expect(screen.getByText("verify-me")).toBeInTheDocument();
    expect(screen.getByText("TXT")).toBeInTheDocument();
  });

  it("hides the record once the address is live", async () => {
    mockApi([domain({ id: "d2", hostname: "www.customer.test", kind: "custom", isPrimary: false,
      verification: { method: "cname", name: "www.customer.test", value: "origin.platform.test" } })]);
    renderWithProviders(<DomainsPanel workspaceId="w1" projectId="p1" />);

    await screen.findByText("www.customer.test");
    expect(screen.queryByText("Add this record at your DNS provider")).not.toBeInTheDocument();
  });
});

describe("primary address", () => {
  it("only offers to promote an address that already works", async () => {
    mockApi([
      domain(),
      domain({ id: "d2", hostname: "pending.customer.test", kind: "custom", isPrimary: false, status: "pending_ssl", sslStatus: "pending" }),
      domain({ id: "d3", hostname: "live.customer.test", kind: "custom", isPrimary: false }),
    ]);
    renderWithProviders(<DomainsPanel workspaceId="w1" projectId="p1" />);

    await screen.findByText("live.customer.test");
    // Exactly one: the pending domain must not be promotable, or every other address would redirect
    // to one that does not answer.
    expect(screen.getAllByRole("button", { name: "Make main" })).toHaveLength(1);
  });
});

describe("connecting", () => {
  it("normalises what the customer typed before sending it", async () => {
    const calls = mockApi([]);
    renderWithProviders(<DomainsPanel workspaceId="w1" projectId="p1" />);

    await userEvent.type(screen.getByLabelText("Domain"), "  WWW.Customer.test  ");
    expect(await screen.findByText("This will become www.customer.test")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(calls.some((call) => call.includes("/domains/custom"))).toBe(true));
  });

  it("keeps the claim visible when the certificate provider is unreachable", async () => {
    mockApi([], {
      onConnect: () =>
        new Response(
          JSON.stringify({ data: { domain: domain({ kind: "custom" }), providerReachable: false } }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
    });
    renderWithProviders(<DomainsPanel workspaceId="w1" projectId="p1" />);

    await userEvent.type(screen.getByLabelText("Domain"), "www.customer.test");
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/could not reach the certificate provider/);
  });
});

describe("disconnecting", () => {
  it("confirms and says plainly that the site is not deleted", async () => {
    const calls = mockApi([domain({ id: "d2", hostname: "www.customer.test", kind: "custom", isPrimary: false })]);
    renderWithProviders(<DomainsPanel workspaceId="w1" projectId="p1" />);

    await userEvent.click(await screen.findByRole("button", { name: "Disconnect" }));

    expect(screen.getByText("Disconnect www.customer.test?")).toBeInTheDocument();
    expect(screen.getByText(/The site itself and its free address are not affected/)).toBeInTheDocument();
    expect(calls.some((call) => call.startsWith("DELETE"))).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "Yes, disconnect" }));
    await waitFor(() => expect(calls.some((call) => call.startsWith("DELETE"))).toBe(true));
  });
});
