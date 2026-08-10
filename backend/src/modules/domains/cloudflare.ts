import {
  ProviderError,
  toDomainStatus,
  type CustomHostnameProvider,
  type ProviderHostname,
  type ProviderVerification,
} from "./provider";

/**
 * Cloudflare for SaaS adapter.
 *
 * The endpoint is configurable so tests never reach the real API, and the token is read once here
 * and never returned, logged or included in an error. Errors are translated into the product's own
 * reasons: nothing above this file should have to recognise a Cloudflare error code.
 */
export type CloudflareConfig = {
  apiBaseUrl: string;
  zoneId: string;
  apiToken: string;
  /** The hostname customer records point at. */
  originHostname: string;
  timeoutMs?: number;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
  /** Injected so backoff is deterministic in tests rather than wall-clock dependent. */
  sleep?: (ms: number) => Promise<void>;
};

type CloudflareCustomHostname = {
  id: string;
  hostname: string;
  status?: string;
  ssl?: { status?: string; validation_errors?: Array<{ message?: string }> };
  ownership_verification?: { type?: string; name?: string; value?: string };
  ownership_verification_http?: { http_url?: string; http_body?: string };
  verification_errors?: string[];
};

type CloudflareEnvelope<T> = {
  success: boolean;
  result?: T;
  errors?: Array<{ code?: number; message?: string }>;
};

export class CloudflareHostnameProvider implements CustomHostnameProvider {
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly config: CloudflareConfig) {
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.maxAttempts = config.maxAttempts ?? 3;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async create(hostname: string): Promise<ProviderHostname> {
    // Ask first. A retried create that raced with itself must return the existing registration
    // rather than a second one competing for the same customer hostname.
    const existing = await this.findByHostname(hostname);
    if (existing !== null) return existing;

    try {
      const result = await this.request<CloudflareCustomHostname>("POST", this.collectionPath(), {
        hostname,
        ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } },
      });
      return this.toProviderHostname(result);
    } catch (error) {
      // Cloudflare answers a duplicate with a conflict; the registration that already exists is the
      // correct answer to a create.
      if (error instanceof ProviderError && error.reason === "conflict") {
        const found = await this.findByHostname(hostname);
        if (found !== null) return found;
      }
      throw error;
    }
  }

  async get(providerHostnameId: string): Promise<ProviderHostname> {
    return this.toProviderHostname(
      await this.request<CloudflareCustomHostname>("GET", `${this.collectionPath()}/${providerHostnameId}`),
    );
  }

  async refresh(providerHostnameId: string): Promise<ProviderHostname> {
    // A PATCH with the same SSL settings is Cloudflare's way of asking for re-validation now.
    return this.toProviderHostname(
      await this.request<CloudflareCustomHostname>("PATCH", `${this.collectionPath()}/${providerHostnameId}`, {
        ssl: { method: "http", type: "dv" },
      }),
    );
  }

  async delete(providerHostnameId: string): Promise<void> {
    try {
      await this.request<unknown>("DELETE", `${this.collectionPath()}/${providerHostnameId}`);
    } catch (error) {
      // Disconnecting something already gone is the outcome the caller wanted.
      if (error instanceof ProviderError && error.reason === "not-found") return;
      throw error;
    }
  }

  private async findByHostname(hostname: string): Promise<ProviderHostname | null> {
    const results = await this.request<CloudflareCustomHostname[]>(
      "GET",
      `${this.collectionPath()}?hostname=${encodeURIComponent(hostname)}`,
    );
    const match = results.find((candidate) => candidate.hostname === hostname);
    return match === undefined ? null : this.toProviderHostname(match);
  }

  private collectionPath(): string {
    return `/zones/${this.config.zoneId}/custom_hostnames`;
  }

  /**
   * One HTTP call, with a timeout and bounded retries.
   *
   * Only reasons that can succeed unchanged are retried. Retrying an unauthorized or invalid
   * request just multiplies the failure and, on a rate-limited endpoint, deepens the hole.
   */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let lastError: ProviderError | null = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await this.attempt<T>(method, path, body);
      } catch (error) {
        if (!(error instanceof ProviderError) || !error.retryable || attempt === this.maxAttempts) throw error;
        lastError = error;
        // Exponential backoff: 200ms, 400ms, 800ms.
        await this.sleep(200 * 2 ** (attempt - 1));
      }
    }

    throw lastError ?? new ProviderError("unavailable", "The domain provider did not respond");
  }

  private async attempt<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.apiBaseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.config.apiToken}`,
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      // Any transport failure, including the abort above, is a timeout from the caller's point of
      // view: the request may still succeed later.
      throw new ProviderError("timeout", `The domain provider did not respond (${describe(error)})`);
    } finally {
      clearTimeout(timer);
    }

    const envelope = (await response.json().catch(() => null)) as CloudflareEnvelope<T> | null;

    if (!response.ok || envelope === null || envelope.success !== true) {
      throw toProviderError(response.status, envelope);
    }
    if (envelope.result === undefined) {
      throw new ProviderError("unavailable", "The domain provider returned an empty result");
    }

    return envelope.result;
  }

  private toProviderHostname(result: CloudflareCustomHostname): ProviderHostname {
    const sslStatus = mapSslStatus(result.ssl?.status);
    const ownershipVerified = result.status === "active";
    const failure =
      result.verification_errors?.[0] ?? result.ssl?.validation_errors?.[0]?.message ?? undefined;

    return {
      providerHostnameId: result.id,
      hostname: result.hostname,
      status: toDomainStatus({
        ownershipVerified,
        sslStatus,
        failed: result.status === "moved" || result.status === "deleted",
      }),
      sslStatus,
      verification: this.verificationFor(result),
      failureCode: failure,
    };
  }

  /**
   * What the customer must create in their DNS.
   *
   * Cloudflare returns a TXT challenge only while ownership is unproven; once it is proven the
   * lasting instruction is the CNAME that points their hostname at this platform.
   */
  private verificationFor(result: CloudflareCustomHostname): ProviderVerification {
    const txt = result.ownership_verification;
    if (txt?.name !== undefined && txt.value !== undefined) {
      return { method: "txt", name: txt.name, value: txt.value };
    }

    const http = result.ownership_verification_http;
    if (http?.http_url !== undefined) {
      return { method: "http", name: http.http_url, value: http.http_body };
    }

    return { method: "cname", name: result.hostname, value: this.config.originHostname };
  }
}

function mapSslStatus(status: string | undefined): "pending" | "active" | "failed" {
  if (status === "active") return "active";
  if (status === "deleted" || status === "deactivated" || status?.includes("timed_out") === true) return "failed";
  return "pending";
}

function toProviderError(httpStatus: number, envelope: CloudflareEnvelope<unknown> | null): ProviderError {
  const message = envelope?.errors?.[0]?.message ?? "The domain provider rejected the request";
  const code = envelope?.errors?.[0]?.code;

  if (httpStatus === 401 || httpStatus === 403) {
    // Never echo the provider's message here: it can quote the request, including the token.
    return new ProviderError("unauthorized", "The domain provider rejected our credentials");
  }
  if (httpStatus === 404) return new ProviderError("not-found", message);
  if (httpStatus === 409 || code === 1406) return new ProviderError("conflict", message);
  if (httpStatus === 429) return new ProviderError("rate-limited", message);
  if (httpStatus >= 500) return new ProviderError("unavailable", message);
  return new ProviderError("invalid-hostname", message);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.name : "unknown error";
}
