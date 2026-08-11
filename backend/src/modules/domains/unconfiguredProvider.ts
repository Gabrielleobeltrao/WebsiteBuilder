import { ProviderError, type CustomHostnameProvider, type ProviderHostname } from "./provider";

/**
 * Stands in for the provider when no credentials are configured in production.
 *
 * The danger of a missing token is not that the platform runs — it is that a customer connects a
 * domain and is told it worked while nothing was registered anywhere. So the failure belongs at the
 * moment someone tries, not at start-up: platform subdomains publish and serve normally, and the
 * one feature that genuinely needs a provider says plainly that it is unavailable.
 *
 * The in-memory fake must never take this role. It answers successfully, which is exactly the lie
 * this exists to prevent.
 */
export class UnconfiguredHostnameProvider implements CustomHostnameProvider {
  private fail(): never {
    // Retryable: the fix is configuration, and the request will work once it lands. Nothing about
    // it is wrong on the caller's side.
    throw new ProviderError("unavailable", "Custom domains are not configured on this deployment");
  }

  async create(): Promise<ProviderHostname> {
    this.fail();
  }

  async get(): Promise<ProviderHostname> {
    this.fail();
  }

  async refresh(): Promise<ProviderHostname> {
    this.fail();
  }

  async delete(): Promise<void> {
    // Disconnecting is allowed: there is nothing registered to remove, and refusing would trap a
    // customer's domain in a record they cannot delete.
  }
}
