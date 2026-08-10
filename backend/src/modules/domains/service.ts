import { isDomainLive, normalizeHostname, type SiteDomain } from "@websitebuilder/shared";
import { ObjectId, type Collection, type Db } from "mongodb";

import { PUBLISHING_COLLECTIONS } from "../publishing/repository";
import type { WorkspaceContext } from "../projects/repository";
import { ProviderError, type CustomHostnameProvider } from "./provider";

/**
 * Custom-domain lifecycle.
 *
 * A domain is stored locally the moment it is claimed, and the provider is asked separately. That
 * order matters: a provider outage leaves the claim recorded and retryable instead of losing it,
 * and — because the renderer serves only domains that are already active — an outage cannot take a
 * working customer site offline.
 */
type DomainDocument = Omit<SiteDomain, "id"> & { _id: ObjectId };

export type ConnectOutcome =
  | { status: "connected"; domain: SiteDomain }
  | { status: "pending-provider"; domain: SiteDomain; reason: string }
  | { status: "rejected"; reason: "invalid-hostname" | "already-connected" | "platform-domain" };

export class DomainService {
  private readonly domains: Collection<DomainDocument>;

  constructor(
    db: Db,
    private readonly provider: CustomHostnameProvider,
    private readonly platformRootDomain: string,
  ) {
    this.domains = db.collection<DomainDocument>(PUBLISHING_COLLECTIONS.domains);
  }

  async connect(context: WorkspaceContext, projectId: string, rawHostname: string): Promise<ConnectOutcome> {
    const hostname = normalizeHostname(rawHostname);
    if (hostname === null) return { status: "rejected", reason: "invalid-hostname" };

    // The platform's own space is not something a customer may claim: a hostname under it is
    // already routed by the wildcard and would collide with a project subdomain.
    if (hostname === this.platformRootDomain || hostname.endsWith(`.${this.platformRootDomain}`)) {
      return { status: "rejected", reason: "platform-domain" };
    }

    const existing = await this.domains.findOne({ hostname });
    if (existing !== null) {
      // Deliberately the same answer whether the hostname belongs to this project or to another
      // customer: which tenants own which domains is not something this endpoint discloses.
      return { status: "rejected", reason: "already-connected" };
    }

    const now = new Date().toISOString();
    const document: Omit<DomainDocument, "_id"> = {
      workspaceId: context.workspaceId,
      projectId,
      hostname,
      kind: "custom",
      status: "pending_dns",
      isPrimary: false,
      provider: "cloudflare_for_saas",
      sslStatus: "pending",
      createdAt: now,
    };

    const inserted = await this.domains.insertOne(document as DomainDocument);
    const stored: SiteDomain = { ...document, id: inserted.insertedId.toHexString() };

    try {
      const registered = await this.provider.create(hostname);
      const updated = await this.applyProviderState(stored.id, registered);
      return { status: "connected", domain: updated };
    } catch (error) {
      if (error instanceof ProviderError) {
        // The claim stays. Refresh will pick it up once the provider is reachable again.
        await this.domains.updateOne(
          { _id: inserted.insertedId },
          { $set: { failureCode: error.reason, lastCheckedAt: now } },
        );
        return { status: "pending-provider", domain: { ...stored, failureCode: error.reason }, reason: error.reason };
      }
      throw error;
    }
  }

  /**
   * Re-reads a domain's real state from the provider.
   *
   * The stored status is a cache of the provider's answer; nothing is ever promoted to active
   * because time passed or because a customer said the DNS was ready.
   */
  async refresh(context: WorkspaceContext, domainId: ObjectId): Promise<SiteDomain | null> {
    const domain = await this.domains.findOne({ _id: domainId, workspaceId: context.workspaceId });
    if (domain === null) return null;

    if (domain.kind === "platform") return toDomain(domain);

    const now = new Date().toISOString();

    try {
      const state =
        domain.providerHostnameId === undefined
          ? await this.provider.create(domain.hostname)
          : await this.provider.get(domain.providerHostnameId);

      return await this.applyProviderState(domainId.toHexString(), state);
    } catch (error) {
      if (error instanceof ProviderError) {
        await this.domains.updateOne(
          { _id: domainId },
          { $set: { lastCheckedAt: now, failureCode: error.reason } },
        );
        // The previously known state is returned unchanged. A provider outage must not demote a
        // domain that is serving traffic.
        return { ...toDomain(domain), lastCheckedAt: now, failureCode: error.reason };
      }
      throw error;
    }
  }

  /**
   * Removes a custom domain.
   *
   * The project, its content and its platform hostname are untouched — disconnecting an address is
   * not deleting a site. A provider that has already forgotten the hostname is a success.
   */
  async disconnect(context: WorkspaceContext, domainId: ObjectId): Promise<boolean> {
    const domain = await this.domains.findOne({ _id: domainId, workspaceId: context.workspaceId });
    if (domain === null) return false;
    if (domain.kind === "platform") return false;

    if (domain.providerHostnameId !== undefined) {
      try {
        await this.provider.delete(domain.providerHostnameId);
      } catch (error) {
        if (!(error instanceof ProviderError) || !error.retryable) throw error;
        // A retryable provider failure must not block the customer from taking their domain back.
        // The local mapping goes either way; the orphan is reconciled by the next sweep.
      }
    }

    await this.domains.deleteOne({ _id: domainId });
    return true;
  }

  private async applyProviderState(domainId: string, state: Parameters<typeof stateFields>[0]): Promise<SiteDomain> {
    const _id = new ObjectId(domainId);

    const fields = stateFields(state);
    await this.domains.updateOne({ _id }, { $set: fields, $unset: fields.failureCode === undefined ? { failureCode: "" } : {} });

    const updated = await this.domains.findOne({ _id });
    return toDomain(updated!);
  }
}

function stateFields(state: {
  providerHostnameId: string;
  status: SiteDomain["status"];
  sslStatus: "pending" | "active" | "failed";
  verification?: SiteDomain["verification"];
  failureCode?: string;
}) {
  const now = new Date().toISOString();
  const live = isDomainLive({ status: state.status, sslStatus: state.sslStatus });

  return {
    providerHostnameId: state.providerHostnameId,
    status: state.status,
    sslStatus: state.sslStatus,
    verification: state.verification,
    lastCheckedAt: now,
    // Only stamped once every stage is genuinely complete, so "verified" never means "we assume so".
    ...(live ? { verifiedAt: now } : {}),
    ...(state.failureCode === undefined ? {} : { failureCode: state.failureCode }),
  };
}

function toDomain(document: DomainDocument): SiteDomain {
  const { _id, ...rest } = document;
  return { ...rest, id: _id.toHexString() };
}
