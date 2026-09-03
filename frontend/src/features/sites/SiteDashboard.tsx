import { isVisibleInNavigation, type SiteFeatureKey, type SiteFeatureState } from "@websitebuilder/shared";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import { ApiError } from "@/api/client";
import { projectsApi } from "@/api/projects";
import { siteStatusApi, type SiteStatus } from "@/api/site-status";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ReadinessPanel } from "@/features/sites/ReadinessPanel";

type LoadState = { status: "loading" } | { status: "error"; code: string } | { status: "ready"; site: SiteStatus };

/**
 * Site dashboard with contextual module navigation.
 *
 * Core entries are always present. Optional modules appear only once the server's reconciled
 * projection says they are in use — never from a local flag, and never merely because the user
 * browsed the Elements library. That is what keeps a site with no blog from carrying a Blog entry
 * for its whole life.
 */
export const MODULE_ROUTES: Record<SiteFeatureKey, string | null> = {
  blog: "blog",
  forms: "forms",
  cms: "cms",
  // No destination yet. Written as null rather than as a path that does not exist, so nothing
  // renders a link to it and the route test knows not to demand one.
  search: null,
};

/**
 * What a module's row says about itself.
 *
 * `ready` is here because a module that is on and has nothing wrong with it used to say nothing at
 * all — and, before the lifecycle was corrected, said "Setup required" instead, naming a task that
 * did not exist. A row that reports a problem is a row somebody has to be able to act on, so the
 * only red state is one with a real blocking issue behind it.
 */
function badgeFor(feature: SiteFeatureState): { key: string; tone: string } | null {
  if (feature.blockingIssueCount > 0) return { key: "needs_setup", tone: "bg-red-50 text-red-800 ring-red-200" };
  if (feature.lifecycle === "published") return { key: "published", tone: "bg-accent-50 text-accent-800 ring-accent-200" };
  if (feature.lifecycle === "draft") return { key: "draft", tone: "bg-ink-50 text-ink-700 ring-ink-200" };
  if (feature.lifecycle === "needs_setup") return { key: "needs_setup", tone: "bg-red-50 text-red-800 ring-red-200" };
  if (feature.lifecycle === "ready") return { key: "ready", tone: "bg-ink-50 text-ink-700 ring-ink-200" };
  return null;
}

export function SiteDashboard({
  workspaceId,
  projectId,
  projectName,
  pageCount,
  updatedAt,
  onRenamed,
}: {
  workspaceId: string;
  projectId: string;
  projectName: string;
  pageCount: number;
  updatedAt: string;
  /** Lets the page above keep the heading in step with a rename. */
  onRenamed?: (name: string) => void;
}) {
  const { t } = useTranslation(["dashboard", "cms", "publishing", "analytics", "errors", "common"]);
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: "loading" });
      try {
        const site = await siteStatusApi.load(workspaceId, projectId, signal ? { signal } : {});
        setState({ status: "ready", site });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error", code: error instanceof ApiError ? error.code : "INTERNAL_ERROR" });
      }
    },
    [workspaceId, projectId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const base = `/app/${workspaceId}/sites/${projectId}`;
  const visibleModules =
    state.status === "ready" ? state.site.features.filter((feature) => isVisibleInNavigation(feature.lifecycle)) : [];

  // Untouched modules that have somewhere to go. Derived rather than listed, so a module gaining a
  // destination gains its way in without anybody remembering to add it here.
  const startable =
    state.status === "ready"
      ? state.site.features.filter(
          (feature) => !isVisibleInNavigation(feature.lifecycle) && MODULE_ROUTES[feature.feature] !== null,
        )
      : [];

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-950">{projectName}</h1>
          <p className="mt-1 text-sm text-ink-600">{t("dashboard:site.overview")}</p>
        </div>
        <div className="flex gap-2">
          <Link
            to={`/preview/${workspaceId}/${projectId}`}
            className="rounded-md border border-ink-200 px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
          >
            {t("dashboard:site.preview")}
          </Link>
          <Link
            to={`${base}/builder`}
            className="rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700"
          >
            {t("dashboard:site.editSite")}
          </Link>
        </div>
      </div>

      {state.status === "loading" && (
        <p role="status" className="mt-8 rounded-lg border border-ink-100 p-8 text-center text-ink-500">
          {t("dashboard:site.status.loading")}
        </p>
      )}

      {state.status === "error" && (
        <div role="alert" className="mt-8 rounded-lg border border-red-200 bg-red-50 p-6">
          <h2 className="font-medium text-red-900">{t("dashboard:site.status.error")}</h2>
          <p className="mt-1 text-sm text-red-800">{t(`errors:${state.code}` as "errors:INTERNAL_ERROR")}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-4 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-900"
          >
            {t("common:actions.retry")}
          </button>
        </div>
      )}

      {state.status === "ready" && (
        <>
          {/* Persistent status, not a toast: unresolved setup work stays visible until it is done. */}
          <section
            aria-labelledby="site-status-heading"
            className={[
              "mt-8 rounded-xl border p-5",
              state.site.blocked ? "border-red-200 bg-red-50" : "border-ink-200 bg-white",
            ].join(" ")}
          >
            <h2 id="site-status-heading" className="text-sm font-semibold text-ink-900">
              {t("dashboard:site.status.title")}
            </h2>
            <p className={`mt-1 text-sm ${state.site.blocked ? "text-red-800" : "text-ink-600"}`}>
              {state.site.blocked ? t("dashboard:site.status.blocked") : t("dashboard:site.status.ready")}
            </p>
            {state.site.blockingIssueCount > 0 && (
              <p className="mt-2 text-xs font-medium text-red-800">
                {t("dashboard:site.issues", { count: state.site.blockingIssueCount })}
              </p>
            )}
          </section>

          {/* Readiness sits above the counts: what still needs attention matters more than how many
              pages there are. It reports and never claims the site may be published. */}
          <div className="mt-6">
            {/* Absent rather than empty when a server has not sent it: every category then reads
                  "not checked", which is what the panel is built to say. Reading it unguarded made a
                  version skew take the whole dashboard down. */}
              <ReadinessPanel categories={state.site.readiness ?? {}} currentRevision={state.site.revision} />
          </div>

          <dl className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-ink-200 bg-white p-4">
              <dt className="text-xs text-ink-500">{t("dashboard:site.cards.pages")}</dt>
              <dd className="mt-1 font-display text-2xl font-semibold text-ink-900">{pageCount}</dd>
            </div>
            <div className="rounded-lg border border-ink-200 bg-white p-4">
              <dt className="text-xs text-ink-500">{t("dashboard:site.cards.modules")}</dt>
              <dd className="mt-1 font-display text-2xl font-semibold text-ink-900">{visibleModules.length}</dd>
            </div>
            <div className="rounded-lg border border-ink-200 bg-white p-4">
              <dt className="text-xs text-ink-500">{t("dashboard:site.cards.lastUpdate")}</dt>
              <dd className="mt-1 text-sm text-ink-700">{new Date(updatedAt).toLocaleDateString()}</dd>
            </div>
          </dl>

          <nav aria-label={t("dashboard:site.core")} className="mt-8">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-500">{t("dashboard:site.core")}</h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              <li>
                <Link
                  to={`${base}/builder`}
                  className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50"
                >
                  {t("dashboard:site.pages")}
                </Link>
              </li>
              <li>
                <Link
                  to={`${base}/media`}
                  className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50"
                >
                  {t("dashboard:media.title")}
                </Link>
              </li>
              <li>
                <Link
                  to={`${base}/cms`}
                  className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50"
                >
                  {t("cms:collections.title")}
                </Link>
              </li>
              <li>
                <Link
                  to={`${base}/publish`}
                  className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50"
                >
                  {t("publishing:publish.title")}
                </Link>
              </li>
              <li>
                <Link
                  to={`${base}/analytics`}
                  className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50"
                >
                  {t("analytics:title")}
                </Link>
              </li>
              <li>
                <Link
                  to={`${base}/settings/domains`}
                  className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50"
                >
                  {t("publishing:domains.title")}
                </Link>
              </li>
            </ul>
          </nav>

          <nav aria-label={t("dashboard:site.optional")} className="mt-6">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              {t("dashboard:site.optional")}
            </h2>
            {visibleModules.length === 0 ? (
              <p className="mt-2 text-sm text-ink-500">{t("dashboard:site.noOptionalModules")}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {visibleModules.map((feature) => {
                  const badge = badgeFor(feature);
                  return (
                    <li key={feature.feature}>
                      <Link
                        to={`${base}/${MODULE_ROUTES[feature.feature]}`}
                        className="flex items-center justify-between gap-3 rounded-md border border-ink-200 px-3 py-2
                          text-sm text-ink-800 hover:bg-ink-50"
                      >
                        <span>{t(`dashboard:site.nav.${feature.feature}`)}</span>
                        {badge && (
                          <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${badge.tone}`}>
                            {t(`dashboard:site.badge.${badge.key}` as "dashboard:site.badge.draft")}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}

            {/*
              A way in to the modules this site is not using yet.
              An optional module stays out of the permanent navigation on purpose — that is what
              keeps a site with no blog from carrying a Blog entry for its whole life — but "not in
              the navigation" had come to mean "unreachable": the blog could only be turned on from
              its own page, and nothing anywhere linked to that page.
            */}
            {startable.length > 0 && (
              <p className="mt-3 text-xs text-ink-500">
                {t("dashboard:site.startModule")}{" "}
                {startable.map((feature, index) => (
                  <span key={feature.feature}>
                    {index > 0 && " · "}
                    <Link to={`${base}/${MODULE_ROUTES[feature.feature]}`} className="underline underline-offset-2">
                      {t(`dashboard:site.nav.${feature.feature}`)}
                    </Link>
                  </span>
                ))}
              </p>
            )}
          </nav>

          <SiteSettings
            workspaceId={workspaceId}
            projectId={projectId}
            projectName={projectName}
            onRenamed={onRenamed}
          />
        </>
      )}
    </div>
  );
}

/**
 * Renaming and deleting a site.
 *
 * They live here rather than on the site list because that is where they belong: the list is for
 * finding a site and doing the thing you came to do, and a delete button beside "Open" on every row
 * is a destructive action one mis-tap away — on a phone, next to the button people press most.
 */
function SiteSettings({
  workspaceId,
  projectId,
  projectName,
  onRenamed,
}: {
  workspaceId: string;
  projectId: string;
  projectName: string;
  onRenamed?: (name: string) => void;
}) {
  const { t } = useTranslation(["dashboard", "errors"]);
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<"none" | "rename" | "delete">("none");
  const [name, setName] = useState(projectName);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>, after: () => void) => {
    setBusy(true);
    setFailure(null);
    try {
      await action();
      setDialog("none");
      after();
    } catch (error) {
      setDialog("none");
      setFailure(error instanceof ApiError ? error.code : "INTERNAL_ERROR");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-10">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
        {t("dashboard:site.settings")}
      </h2>

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setName(projectName);
            setDialog("rename");
          }}
          className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50"
        >
          {t("dashboard:sites.rename")}
        </button>
        <button
          type="button"
          onClick={() => setDialog("delete")}
          className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-800 hover:bg-red-50"
        >
          {t("dashboard:sites.delete")}
        </button>
      </div>

      {failure !== null && (
        <p role="alert" className="mt-3 text-sm text-red-800">
          {t(`errors:${failure}` as "errors:INTERNAL_ERROR")}
        </p>
      )}

      <ConfirmDialog
        open={dialog === "rename"}
        title={t("dashboard:sites.renameTitle")}
        confirmLabel={t("dashboard:sites.confirmRename")}
        busy={busy}
        onCancel={() => setDialog("none")}
        onConfirm={() => {
          const trimmed = name.trim();
          if (trimmed.length === 0) return;
          void run(
            () => projectsApi.rename(workspaceId, projectId, trimmed),
            () => onRenamed?.(trimmed),
          );
        }}
      >
        <label className="block text-sm font-medium text-ink-700">
          {t("dashboard:sites.nameLabel")}
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
          />
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === "delete"}
        destructive
        title={t("dashboard:sites.deleteTitle")}
        description={t("dashboard:sites.deleteWarning")}
        confirmLabel={t("dashboard:sites.confirmDelete")}
        busy={busy}
        onCancel={() => setDialog("none")}
        onConfirm={() => {
          // Back to the list: staying on the page of a site that no longer exists would show an
          // error for something that worked.
          void run(
            () => projectsApi.remove(workspaceId, projectId),
            () => navigate(`/app/${workspaceId}/sites`, { replace: true }),
          );
        }}
      />
    </section>
  );
}
