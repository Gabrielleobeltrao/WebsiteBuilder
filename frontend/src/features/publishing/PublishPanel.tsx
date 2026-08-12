import { deviceForWidth, isDomainLive, type PreflightIssue, type SiteDomain } from "@websitebuilder/shared";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { ApiError } from "@/api/client";
import { publishingApi, type PreflightResponse, type VersionSummary } from "@/api/publishing";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

/**
 * Publish, history and rollback.
 *
 * The blockers shown here come from the same preflight the server runs before it will publish, so
 * this screen and the Site status centre cannot disagree about whether a site is ready. Nothing is
 * decided in the browser: the button being enabled is a hint, and the server checks again.
 */
type State = {
  preflight: PreflightResponse | null;
  versions: VersionSummary[];
  domains: SiteDomain[];
  loading: boolean;
  error: string | null;
  notice: { kind: "published" | "unchanged" | "restored"; version?: number } | null;
};

const INITIAL: State = {
  preflight: null,
  versions: [],
  domains: [],
  loading: true,
  error: null,
  notice: null,
};

export function PublishPanel({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  const { t, i18n } = useTranslation(["publishing", "errors", "common"]);
  const [state, setState] = useState<State>(INITIAL);
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState<VersionSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState((current) => ({ ...current, loading: true, error: null }));
      try {
        const scope = signal ? { signal } : {};
        const [preflight, versions, domains] = await Promise.all([
          publishingApi.preflight(workspaceId, projectId, scope),
          publishingApi.history(workspaceId, projectId, scope),
          publishingApi.domains(workspaceId, projectId, scope),
        ]);
        setState((current) => ({ ...current, preflight, versions, domains, loading: false }));
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState((current) => ({
          ...current,
          loading: false,
          error: error instanceof ApiError ? error.code : "INTERNAL_ERROR",
        }));
      }
    },
    [workspaceId, projectId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const publish = async () => {
    setBusy(true);
    try {
      const result = await publishingApi.publish(workspaceId, projectId);
      setConfirming(false);
      setState((current) => ({
        ...current,
        notice: { kind: result.unchanged ? "unchanged" : "published" },
      }));
      await load();
    } catch (error) {
      setConfirming(false);
      setState((current) => ({
        ...current,
        error: error instanceof ApiError ? error.code : "INTERNAL_ERROR",
      }));
      // A refused publish usually means new blockers, so the report is reloaded rather than kept.
      await load();
    } finally {
      setBusy(false);
    }
  };

  const rollback = async (version: VersionSummary) => {
    setBusy(true);
    try {
      await publishingApi.rollback(workspaceId, projectId, version.id);
      setRestoring(null);
      setState((current) => ({ ...current, notice: { kind: "restored", version: version.version } }));
      await load();
    } catch (error) {
      setRestoring(null);
      setState((current) => ({ ...current, error: error instanceof ApiError ? error.code : "INTERNAL_ERROR" }));
    } finally {
      setBusy(false);
    }
  };

  const report = state.preflight?.report ?? null;
  const blocking = report?.issues.filter((issue) => issue.severity === "blocking") ?? [];
  const warnings = report?.issues.filter((issue) => issue.severity === "warning") ?? [];
  const live = state.versions.find((version) => version.version === Math.max(...state.versions.map((v) => v.version)));
  const liveDomain = state.domains.find((domain) => domain.isPrimary && isDomainLive(domain)) ?? state.domains[0];

  // The live version was compiled from a specific revision; a newer draft means unpublished work.
  const hasUnpublishedChanges =
    live !== undefined && report !== null && report.sourceRevision > live.sourceRevision;

  const formatDate = (value: string) => new Date(value).toLocaleString(i18n.language);

  return (
    <section aria-labelledby="publish-heading" className="space-y-8">
      <header>
        {/* The page's own heading. It is the only thing on this route, and every sibling route —
            sites, overview, analytics — opens with an h1; a page whose top heading is an h2 reads to
            a screen reader as a section of something that is not there. */}
        <h1 id="publish-heading" className="font-display text-xl font-semibold text-ink-950">
          {t("publishing:publish.title")}
        </h1>
        <p className="mt-1 text-sm text-ink-600">{t("publishing:publish.subtitle")}</p>
      </header>

      {state.error !== null && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">
          {t(`errors:${state.error}` as "errors:INTERNAL_ERROR")}
        </p>
      )}

      {state.notice !== null && (
        <p role="status" className="rounded-lg bg-accent-50 px-4 py-3 text-sm text-accent-900 ring-1 ring-accent-200">
          {state.notice.kind === "restored"
            ? t("publishing:history.restored", { version: state.notice.version })
            : state.notice.kind === "unchanged"
              ? t("publishing:publish.successUnchanged")
              : t("publishing:publish.success")}
        </p>
      )}

      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg bg-white p-4 ring-1 ring-ink-200">
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
            {t("publishing:publish.address")}
          </dt>
          <dd className="mt-1 text-sm text-ink-900">
            {liveDomain === undefined ? (
              t("publishing:publish.addressPending")
            ) : (
              <a
                href={`https://${liveDomain.hostname}`}
                target="_blank"
                rel="noreferrer"
                className="text-accent-700 underline"
              >
                {liveDomain.hostname}
              </a>
            )}
          </dd>
        </div>

        <div className="rounded-lg bg-white p-4 ring-1 ring-ink-200">
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
            {t("publishing:publish.activeVersion")}
          </dt>
          <dd className="mt-1 text-sm text-ink-900">
            {live === undefined
              ? t("publishing:publish.neverPublished")
              : t("publishing:publish.activeVersionValue", {
                  version: live.version,
                  revision: live.sourceRevision,
                })}
          </dd>
        </div>
      </dl>

      {state.loading ? (
        <p className="text-sm text-ink-600">{t("publishing:publish.checking")}</p>
      ) : blocking.length > 0 ? (
        <IssueList
          title={t("publishing:blockers.title")}
          subtitle={t("publishing:blockers.subtitle")}
          issues={blocking}
          workspaceId={workspaceId}
          projectId={projectId}
          tone="error"
        />
      ) : (
        <p className="text-sm text-ink-700">
          {hasUnpublishedChanges ? t("publishing:publish.unpublishedChanges") : t("publishing:publish.upToDate")}
        </p>
      )}

      {warnings.length > 0 && (
        <IssueList
          title={t("publishing:blockers.warningsTitle")}
          issues={warnings}
          tone="warning"
          workspaceId={workspaceId}
          projectId={projectId}
        />
      )}

      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={state.loading || blocking.length > 0 || busy}
        className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? t("publishing:publish.publishing") : t("publishing:publish.action")}
      </button>

      <section aria-labelledby="history-heading" className="space-y-3">
        <h3 id="history-heading" className="font-display text-lg font-semibold text-ink-950">
          {t("publishing:history.title")}
        </h3>

        {state.versions.length === 0 ? (
          <p className="text-sm text-ink-600">{t("publishing:history.empty")}</p>
        ) : (
          <ul className="divide-y divide-ink-200 rounded-lg bg-white ring-1 ring-ink-200">
            {state.versions.map((version) => (
              <li key={version.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-ink-900">
                    {t("publishing:history.version", { version: version.version })}
                    {version.id === live?.id && (
                      <span className="ml-2 rounded-full bg-accent-50 px-2 py-0.5 text-xs text-accent-800 ring-1 ring-accent-200">
                        {t("publishing:history.live")}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-ink-600">
                    {t("publishing:history.publishedAt", { date: formatDate(version.createdAt) })}
                  </p>
                </div>

                {version.id !== live?.id && (
                  <button
                    type="button"
                    onClick={() => setRestoring(version)}
                    className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-800 ring-1 ring-ink-300"
                  >
                    {t("publishing:history.rollback")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={confirming}
        title={t("publishing:publish.confirmTitle")}
        description={t("publishing:publish.confirmBody")}
        confirmLabel={t("publishing:publish.confirm")}
        busy={busy}
        onConfirm={() => void publish()}
        onCancel={() => setConfirming(false)}
      />

      <ConfirmDialog
        open={restoring !== null}
        title={t("publishing:history.rollbackConfirmTitle", { version: restoring?.version ?? 0 })}
        description={t("publishing:history.rollbackConfirmBody")}
        confirmLabel={t("publishing:history.rollbackConfirm")}
        busy={busy}
        onConfirm={() => restoring !== null && void rollback(restoring)}
        onCancel={() => setRestoring(null)}
      />
    </section>
  );
}

const describeRange = (range: { from: number; to: number }) =>
  range.from === range.to ? `${range.from}px` : `${range.from}–${range.to}px`;

/**
 * Where a finding lives, as an address.
 *
 * Page, device and element travel in the URL rather than in memory, so the link survives a reload
 * and can be shared — and so the builder has one way of being told what to open, not two.
 */
/**
 * Which tab of the inspector holds the field a finding is about.
 *
 * Opening the right block on the right device and then leaving somebody to hunt through three tabs
 * is most of the way to useless. Unlisted codes open on Content, which is where a block's own
 * fields live.
 */
const FINDING_TAB: Record<string, "content" | "style" | "advanced"> = {
  "image-without-alt": "content",
  "gallery-image-without-alt": "content",
  "video-without-id": "content",
  "form-without-definition": "content",
  "menu-empty": "content",
  "countdown-without-target": "content",
  "countdown-without-timezone": "content",
  "download-without-file": "content",
  "logo-without-alt": "content",
  "button-without-link": "content",
  "table-without-headers": "content",
  "responsive-layout": "style",
  "duplicate-anchor": "advanced",
};

function openInBuilder(input: { workspaceId: string; projectId: string; issue: PreflightIssue }): string {
  const { workspaceId, projectId, issue } = input;
  const params = new URLSearchParams();
  if (issue.elementId !== undefined) params.set("element", issue.elementId);

  // The block's own code decides the tab where the responsible field is; layout problems open on
  // Style, which is where geometry and per-device values live.
  const detailCode = issue.code === "block-incomplete" ? (issue.blockCode ?? "") : issue.code;
  params.set("tab", FINDING_TAB[detailCode] ?? "content");

  // The narrowest width the problem appears at is the one worth opening on: it is where the layout
  // has the least room, and fixing it there usually fixes the wider cases too.
  const narrowest = issue.ranges?.reduce((lowest, range) => Math.min(lowest, range.from), Number.POSITIVE_INFINITY);
  if (narrowest !== undefined && Number.isFinite(narrowest)) params.set("device", deviceForWidth(narrowest));

  const query = params.toString();
  return `/app/${workspaceId}/sites/${projectId}/builder/${issue.pageId}${query === "" ? "" : `?${query}`}`;
}

function IssueList({
  title,
  subtitle,
  issues,
  tone,
  workspaceId,
  projectId,
}: {
  title: string;
  subtitle?: string;
  issues: PreflightIssue[];
  tone: "error" | "warning";
  workspaceId: string;
  projectId: string;
}) {
  const { t } = useTranslation("publishing");
  const styles =
    tone === "error" ? "bg-red-50 text-red-900 ring-red-200" : "bg-amber-50 text-amber-900 ring-amber-200";

  return (
    <div className={`rounded-lg px-4 py-3 ring-1 ${styles}`}>
      <p className="text-sm font-medium">{title}</p>
      {subtitle !== undefined && <p className="mt-0.5 text-xs">{subtitle}</p>}
      <ul className="mt-2 space-y-1 text-sm">
        {issues.map((issue, index) => (
          <li key={`${issue.code}-${issue.elementId ?? issue.path ?? index}`}>
            <span>{t(`blockers.${issue.code}` as "blockers.no-pages")}</span>
            {issue.path !== undefined && <span className="ml-1 font-mono text-xs">{issue.path}</span>}
            {issue.code === "responsive-layout" && (
              <>
                <span className="ml-1 text-xs">{issue.detail}</span>
                {issue.ranges !== undefined && issue.ranges.length > 0 && (
                  <span className="ml-1 text-xs">
                    {t("blockers.atWidths", { widths: issue.ranges.map(describeRange).join(", ") })}
                  </span>
                )}
              </>
            )}
            {issue.pageId !== undefined && (
              <Link
                to={openInBuilder({ workspaceId, projectId, issue })}
                className="ml-2 text-xs font-medium underline underline-offset-2"
              >
                {t("blockers.openInBuilder")}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
