import type { DomainStatus } from "@websitebuilder/shared";

/**
 * The custom-hostname provider seam.
 *
 * Everything the product knows about a customer domain is expressed here, so the rest of the
 * codebase never learns which provider is in use and a provider swap touches one file. This is
 * backend-only: provider credentials and raw provider responses must never reach a browser.
 */
export type ProviderVerification = {
  method: "cname" | "txt" | "http";
  /** Record name the customer creates, e.g. `www.example.com`. */
  name?: string;
  /** Value the record must hold. */
  value?: string;
};

export type ProviderHostname = {
  providerHostnameId: string;
  hostname: string;
  /** Ownership of the hostname, which is separate from whether a certificate exists. */
  status: DomainStatus;
  sslStatus: "pending" | "active" | "failed";
  verification?: ProviderVerification;
  failureCode?: string;
};

export type ProviderErrorReason =
  | "unauthorized"
  | "rate-limited"
  | "not-found"
  | "conflict"
  | "invalid-hostname"
  | "unavailable"
  | "timeout";

export class ProviderError extends Error {
  constructor(
    public readonly reason: ProviderErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }

  /** True when the same call may succeed later without any change by the customer. */
  get retryable(): boolean {
    return this.reason === "rate-limited" || this.reason === "unavailable" || this.reason === "timeout";
  }
}

export interface CustomHostnameProvider {
  /**
   * Registers a hostname. Must be idempotent: calling it twice for the same hostname returns the
   * existing registration rather than creating a competing one, because a retried request must not
   * be able to produce two mappings for one customer domain.
   */
  create(hostname: string): Promise<ProviderHostname>;
  get(providerHostnameId: string): Promise<ProviderHostname>;
  /** Asks the provider to re-check ownership and certificate issuance now. */
  refresh(providerHostnameId: string): Promise<ProviderHostname>;
  /** Removes the registration. Deleting something already gone is a success, not an error. */
  delete(providerHostnameId: string): Promise<void>;
}

/**
 * Maps a provider status pair onto the product's own domain status.
 *
 * A domain is only ever advertised as active when ownership and the certificate are both complete;
 * anything else is honestly reported as still in progress.
 */
export function toDomainStatus(input: {
  ownershipVerified: boolean;
  sslStatus: "pending" | "active" | "failed";
  failed?: boolean;
}): DomainStatus {
  if (input.failed === true || input.sslStatus === "failed") return "failed";
  if (!input.ownershipVerified) return "pending_dns";
  return input.sslStatus === "active" ? "active" : "pending_ssl";
}

/**
 * Redacts anything credential-shaped before a provider payload reaches a log.
 *
 * Provider responses echo request context, and a token in an operational log is a token that has
 * leaked. This runs on every logged payload rather than on the ones that looked risky.
 */
export function redactProviderPayload(value: unknown): unknown {
  const SECRET_KEYS = /token|secret|authorization|key|password|bearer/i;

  const walk = (node: unknown, depth: number): unknown => {
    if (depth > 6 || node === null || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map((item) => walk(item, depth + 1));

    return Object.fromEntries(
      Object.entries(node as Record<string, unknown>).map(([key, item]) => [
        key,
        SECRET_KEYS.test(key) ? "[redacted]" : walk(item, depth + 1),
      ]),
    );
  };

  return walk(value, 0);
}
