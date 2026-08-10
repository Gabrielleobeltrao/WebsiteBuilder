import { ProviderError, toDomainStatus, type CustomHostnameProvider, type ProviderHostname } from "./provider";

/**
 * An in-memory provider for development and tests.
 *
 * It exists so no test suite and no local run ever contacts a real provider API. Transitions are
 * driven explicitly rather than by a timer, which is what makes the state machine testable.
 */
export class FakeHostnameProvider implements CustomHostnameProvider {
  private readonly byId = new Map<string, ProviderHostname>();
  private readonly idByHostname = new Map<string, string>();
  private sequence = 0;

  /** Set to make the next call fail, so outage handling is exercised deliberately. */
  public failNextWith: ProviderError | null = null;

  constructor(private readonly originHostname = "origin.example.test") {}

  async create(hostname: string): Promise<ProviderHostname> {
    this.throwIfArmed();

    const existingId = this.idByHostname.get(hostname);
    if (existingId !== undefined) return this.byId.get(existingId)!;

    this.sequence += 1;
    const record: ProviderHostname = {
      providerHostnameId: `fake-${this.sequence}`,
      hostname,
      status: "pending_dns",
      sslStatus: "pending",
      verification: { method: "cname", name: hostname, value: this.originHostname },
    };

    this.byId.set(record.providerHostnameId, record);
    this.idByHostname.set(hostname, record.providerHostnameId);
    return record;
  }

  async get(providerHostnameId: string): Promise<ProviderHostname> {
    this.throwIfArmed();
    const record = this.byId.get(providerHostnameId);
    if (record === undefined) throw new ProviderError("not-found", "Unknown hostname");
    return record;
  }

  async refresh(providerHostnameId: string): Promise<ProviderHostname> {
    return this.get(providerHostnameId);
  }

  async delete(providerHostnameId: string): Promise<void> {
    this.throwIfArmed();
    const record = this.byId.get(providerHostnameId);
    if (record === undefined) return;
    this.byId.delete(providerHostnameId);
    this.idByHostname.delete(record.hostname);
  }

  /** Test control: advances a hostname through the stages a real provider would report. */
  advance(providerHostnameId: string, to: { ownershipVerified?: boolean; sslStatus?: "pending" | "active" | "failed" }): void {
    const record = this.byId.get(providerHostnameId);
    if (record === undefined) throw new ProviderError("not-found", "Unknown hostname");

    const ownershipVerified = to.ownershipVerified ?? record.status !== "pending_dns";
    const sslStatus = to.sslStatus ?? record.sslStatus;

    this.byId.set(providerHostnameId, {
      ...record,
      status: toDomainStatus({ ownershipVerified, sslStatus }),
      sslStatus,
    });
  }

  private throwIfArmed(): void {
    const error = this.failNextWith;
    if (error !== null) {
      this.failNextWith = null;
      throw error;
    }
  }
}
