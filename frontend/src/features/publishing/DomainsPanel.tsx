import { isDomainLive, normalizeHostname, type SiteDomain } from "@websitebuilder/shared";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError } from "@/api/client";
import { publishingApi } from "@/api/publishing";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

/**
 * Site → Settings → Domains.
 *
 * Status text never runs ahead of reality. A domain reads as working only when the server says both
 * ownership and the certificate are complete, because telling someone their address is live while it
 * answers with a certificate error is worse than telling them to wait a few minutes.
 */
export function DomainsPanel({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  const { t, i18n } = useTranslation(["publishing", "errors"]);
  const [domains, setDomains] = useState<SiteDomain[]>([]);
  const [hostname, setHostname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [disconnecting, setDisconnecting] = useState<SiteDomain | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setDomains(await publishingApi.domains(workspaceId, projectId, signal ? { signal } : {}));
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof ApiError ? caught.code : "INTERNAL_ERROR");
      }
    },
    [workspaceId, projectId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const connect = async (event: React.FormEvent) => {
    event.preventDefault();
    setAdding(true);
    setError(null);
    setNotice(null);
    try {
      const result = await publishingApi.connectDomain(workspaceId, projectId, hostname);
      setHostname("");
      if (!result.providerReachable) setNotice(t("publishing:domains.providerUnreachable"));
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.code : "INTERNAL_ERROR");
    } finally {
      setAdding(false);
    }
  };

  const run = async (domainId: string, action: () => Promise<unknown>) => {
    setBusyId(domainId);
    setError(null);
    try {
      await action();
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.code : "INTERNAL_ERROR");
    } finally {
      setBusyId(null);
    }
  };

  const platform = domains.filter((domain) => domain.kind === "platform");
  const custom = domains.filter((domain) => domain.kind === "custom");
  const preview = normalizeHostname(hostname);

  return (
    <section aria-labelledby="domains-heading" className="space-y-8">
      <header>
        <h2 id="domains-heading" className="font-display text-xl font-semibold text-ink-950">
          {t("publishing:domains.title")}
        </h2>
        <p className="mt-1 text-sm text-ink-600">{t("publishing:domains.subtitle")}</p>
      </header>

      {error !== null && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">
          {t(`errors:${error}` as "errors:INTERNAL_ERROR")}
        </p>
      )}

      {notice !== null && (
        <p role="status" className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
          {notice}
        </p>
      )}

      <section aria-labelledby="platform-heading" className="space-y-2">
        <h3 id="platform-heading" className="text-sm font-semibold text-ink-900">
          {t("publishing:domains.platformTitle")}
        </h3>
        <p className="text-xs text-ink-600">{t("publishing:domains.platformHint")}</p>
        <ul className="space-y-2">
          {platform.map((domain) => (
            <li key={domain.id} className="rounded-lg bg-white px-4 py-3 ring-1 ring-ink-200">
              <DomainRow
                domain={domain}
                busy={busyId === domain.id}
                locale={i18n.language}
                onMakePrimary={() =>
                  void run(domain.id, () => publishingApi.makePrimary(workspaceId, projectId, domain.id))
                }
              />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="custom-heading" className="space-y-3">
        <h3 id="custom-heading" className="text-sm font-semibold text-ink-900">
          {t("publishing:domains.customTitle")}
        </h3>

        <form onSubmit={(event) => void connect(event)} className="space-y-2">
          <label htmlFor="domain-hostname" className="block text-sm font-medium text-ink-800">
            {t("publishing:domains.addLabel")}
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="domain-hostname"
              value={hostname}
              onChange={(event) => setHostname(event.target.value)}
              placeholder={t("publishing:domains.addPlaceholder")}
              aria-describedby="domain-hint"
              className="min-w-64 flex-1 rounded-lg px-3 py-2 text-sm ring-1 ring-ink-300"
            />
            <button
              type="submit"
              disabled={adding || hostname.trim().length === 0}
              className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {adding ? t("publishing:domains.adding") : t("publishing:domains.add")}
            </button>
          </div>
          <p id="domain-hint" className="text-xs text-ink-600">
            {t("publishing:domains.addHint")}
          </p>
          {/* Shown whenever normalisation changed anything the customer typed, so the address they
              are about to connect is never a surprise. */}
          {preview !== null && preview !== hostname && (
            <p className="text-xs text-ink-700">{t("publishing:domains.preview", { hostname: preview })}</p>
          )}
        </form>

        {custom.length === 0 ? (
          <p className="text-sm text-ink-600">{t("publishing:domains.empty")}</p>
        ) : (
          <ul className="space-y-3">
            {custom.map((domain) => (
              <li key={domain.id} className="space-y-3 rounded-lg bg-white px-4 py-3 ring-1 ring-ink-200">
                <DomainRow
                  domain={domain}
                  busy={busyId === domain.id}
                  locale={i18n.language}
                  onMakePrimary={() =>
                    void run(domain.id, () => publishingApi.makePrimary(workspaceId, projectId, domain.id))
                  }
                  onRefresh={() =>
                    void run(domain.id, () => publishingApi.refreshDomain(workspaceId, projectId, domain.id))
                  }
                  onDisconnect={() => setDisconnecting(domain)}
                />
                {domain.verification !== undefined && !isDomainLive(domain) && (
                  <VerificationInstructions verification={domain.verification} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={disconnecting !== null}
        title={t("publishing:domains.disconnectConfirmTitle", { hostname: disconnecting?.hostname ?? "" })}
        description={t("publishing:domains.disconnectConfirmBody")}
        confirmLabel={t("publishing:domains.disconnectConfirm")}
        destructive
        busy={busyId !== null}
        onConfirm={() => {
          const target = disconnecting;
          setDisconnecting(null);
          if (target !== null) {
            void run(target.id, () => publishingApi.disconnectDomain(workspaceId, projectId, target.id));
          }
        }}
        onCancel={() => setDisconnecting(null)}
      />
    </section>
  );
}

function DomainRow({
  domain,
  busy,
  locale,
  onMakePrimary,
  onRefresh,
  onDisconnect,
}: {
  domain: SiteDomain;
  busy: boolean;
  locale: string;
  onMakePrimary: () => void;
  onRefresh?: () => void;
  onDisconnect?: () => void;
}) {
  const { t } = useTranslation("publishing");
  const live = isDomainLive(domain);

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="font-mono text-sm text-ink-900">
          {domain.hostname}
          {domain.isPrimary && (
            <span className="ml-2 rounded-full bg-accent-50 px-2 py-0.5 font-sans text-xs text-accent-800 ring-1 ring-accent-200">
              {t("domains.primary")}
            </span>
          )}
        </p>
        <p className={`mt-1 text-xs ${live ? "text-accent-800" : "text-ink-600"}`}>
          {t(`status.${domain.status}` as "status.active")}
        </p>
        <p className="mt-0.5 text-xs text-ink-600">{t(`statusHelp.${domain.status}` as "statusHelp.active")}</p>
        {domain.lastCheckedAt !== undefined && (
          <p className="mt-0.5 text-xs text-ink-500">
            {t("domains.lastChecked", { date: new Date(domain.lastCheckedAt).toLocaleString(locale) })}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {onRefresh !== undefined && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={busy}
            className="rounded-lg px-3 py-1.5 text-sm text-ink-800 ring-1 ring-ink-300 disabled:opacity-50"
          >
            {busy ? t("domains.refreshing") : t("domains.refresh")}
          </button>
        )}
        {/* Only a live address may become canonical: pointing every other domain at one that does
            not answer would take the whole site down. */}
        {!domain.isPrimary && live && (
          <button
            type="button"
            onClick={onMakePrimary}
            disabled={busy}
            className="rounded-lg px-3 py-1.5 text-sm text-ink-800 ring-1 ring-ink-300 disabled:opacity-50"
          >
            {t("domains.makePrimary")}
          </button>
        )}
        {onDisconnect !== undefined && (
          <button
            type="button"
            onClick={onDisconnect}
            disabled={busy}
            className="rounded-lg px-3 py-1.5 text-sm text-red-700 ring-1 ring-red-200 disabled:opacity-50"
          >
            {t("domains.disconnect")}
          </button>
        )}
      </div>
    </div>
  );
}

function VerificationInstructions({ verification }: { verification: NonNullable<SiteDomain["verification"]> }) {
  const { t } = useTranslation("publishing");

  return (
    <div className="rounded-lg bg-ink-50 px-3 py-2 text-xs">
      <p className="font-medium text-ink-900">{t("domains.instructionsTitle")}</p>
      <dl className="mt-2 grid gap-1 sm:grid-cols-[auto_1fr]">
        <dt className="text-ink-600">{t("domains.recordType")}</dt>
        <dd className="font-mono text-ink-900">{verification.method.toUpperCase()}</dd>
        {verification.name !== undefined && (
          <>
            <dt className="text-ink-600">{t("domains.recordName")}</dt>
            <dd className="break-all font-mono text-ink-900">{verification.name}</dd>
          </>
        )}
        {verification.value !== undefined && (
          <>
            <dt className="text-ink-600">{t("domains.recordValue")}</dt>
            <dd className="break-all font-mono text-ink-900">{verification.value}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
