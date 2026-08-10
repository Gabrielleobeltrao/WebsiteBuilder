import { describe, expect, it, vi } from "vitest";

import { CloudflareHostnameProvider } from "../src/modules/domains/cloudflare";
import { ProviderError, redactProviderPayload, toDomainStatus } from "../src/modules/domains/provider";

/**
 * The adapter is exercised against a stubbed fetch. Nothing here contacts a real provider: a test
 * suite that needs network access to a paid API is a test suite that stops being run.
 */
const TOKEN = "cf-token-should-never-appear";

function providerWith(responses: Array<{ status: number; body: unknown }>, options: Record<string, unknown> = {}) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
  let index = 0;

  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const response = responses[Math.min(index, responses.length - 1)]!;
    index += 1;
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  });

  const provider = new CloudflareHostnameProvider({
    apiBaseUrl: "https://api.invalid/client/v4",
    zoneId: "zone-1",
    apiToken: TOKEN,
    originHostname: "origin.example.test",
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => {},
    ...options,
  });

  return { provider, calls, fetchImpl };
}

const ok = (result: unknown) => ({ status: 200, body: { success: true, result } });
const hostname = (overrides: Record<string, unknown> = {}) => ({
  id: "cf-1",
  hostname: "www.customer.test",
  status: "pending",
  ssl: { status: "pending_validation" },
  ownership_verification: { type: "txt", name: "_cf.www.customer.test", value: "verify-me" },
  ...overrides,
});

describe("create", () => {
  it("returns the existing registration instead of creating a competing one", async () => {
    const { provider, calls } = providerWith([ok([hostname()])]);

    const result = await provider.create("www.customer.test");

    expect(result.providerHostnameId).toBe("cf-1");
    // A lookup only. A retried request must not produce a second mapping for one customer domain.
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  });

  it("falls back to the existing registration when the provider reports a conflict", async () => {
    const { provider } = providerWith([
      ok([]),
      { status: 409, body: { success: false, errors: [{ code: 1406, message: "already exists" }] } },
      ok([hostname()]),
    ]);

    expect((await provider.create("www.customer.test")).providerHostnameId).toBe("cf-1");
  });

  it("reports the DNS record the customer must create", async () => {
    const { provider } = providerWith([ok([]), ok(hostname())]);

    const result = await provider.create("www.customer.test");
    expect(result.verification).toEqual({ method: "txt", name: "_cf.www.customer.test", value: "verify-me" });
    expect(result.status).toBe("pending_dns");
  });

  it("instructs a CNAME to the origin once ownership no longer needs a challenge", async () => {
    const { provider } = providerWith([
      ok([]),
      ok(hostname({ status: "active", ownership_verification: {} })),
    ]);

    const result = await provider.create("www.customer.test");
    expect(result.verification).toEqual({
      method: "cname",
      name: "www.customer.test",
      value: "origin.example.test",
    });
  });
});

describe("status mapping", () => {
  it("is active only when ownership and the certificate are both complete", () => {
    expect(toDomainStatus({ ownershipVerified: false, sslStatus: "pending" })).toBe("pending_dns");
    expect(toDomainStatus({ ownershipVerified: true, sslStatus: "pending" })).toBe("pending_ssl");
    expect(toDomainStatus({ ownershipVerified: true, sslStatus: "active" })).toBe("active");
    expect(toDomainStatus({ ownershipVerified: true, sslStatus: "failed" })).toBe("failed");
  });

  it("keeps hostname and certificate status separate", async () => {
    const { provider } = providerWith([ok(hostname({ status: "active", ssl: { status: "pending_validation" } }))]);

    const result = await provider.get("cf-1");
    expect(result.status).toBe("pending_ssl");
    expect(result.sslStatus).toBe("pending");
  });
});

describe("failures", () => {
  it("retries a rate-limited call and succeeds", async () => {
    const { provider, fetchImpl } = providerWith([
      { status: 429, body: { success: false, errors: [{ message: "slow down" }] } },
      ok(hostname()),
    ]);

    expect((await provider.get("cf-1")).providerHostnameId).toBe("cf-1");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a rejected credential", async () => {
    const { provider, fetchImpl } = providerWith([
      { status: 403, body: { success: false, errors: [{ message: `bad token ${TOKEN}` }] } },
    ]);

    await expect(provider.get("cf-1")).rejects.toMatchObject({ reason: "unauthorized" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never puts the token in the error a caller sees", async () => {
    const { provider } = providerWith([
      { status: 403, body: { success: false, errors: [{ message: `token ${TOKEN} is invalid` }] } },
    ]);

    const error = await provider.get("cf-1").catch((thrown: unknown) => thrown);
    expect(String((error as Error).message)).not.toContain(TOKEN);
  });

  it("gives up after the configured number of attempts", async () => {
    const { provider, fetchImpl } = providerWith(
      [{ status: 503, body: { success: false, errors: [{ message: "down" }] } }],
      { maxAttempts: 3 },
    );

    await expect(provider.get("cf-1")).rejects.toMatchObject({ reason: "unavailable" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("treats a transport failure as retryable rather than as a rejection", async () => {
    const provider = new CloudflareHostnameProvider({
      apiBaseUrl: "https://api.invalid/client/v4",
      zoneId: "zone-1",
      apiToken: TOKEN,
      originHostname: "origin.example.test",
      maxAttempts: 1,
      sleep: async () => {},
      fetchImpl: (async () => {
        throw new Error("socket hang up");
      }) as unknown as typeof fetch,
    });

    const error = await provider.get("cf-1").catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).retryable).toBe(true);
  });

  it("treats deleting an unknown hostname as done", async () => {
    const { provider } = providerWith([{ status: 404, body: { success: false, errors: [{ message: "missing" }] } }]);
    await expect(provider.delete("cf-1")).resolves.toBeUndefined();
  });
});

describe("secret redaction", () => {
  it("removes credential-shaped values at any depth", () => {
    const redacted = redactProviderPayload({
      hostname: "www.customer.test",
      headers: { authorization: `Bearer ${TOKEN}` },
      nested: [{ apiToken: TOKEN, safe: "keep" }],
    });

    expect(JSON.stringify(redacted)).not.toContain(TOKEN);
    expect(JSON.stringify(redacted)).toContain("keep");
  });
});
