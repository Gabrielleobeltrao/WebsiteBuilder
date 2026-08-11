import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { ApiError } from "@/api/client";
import { dashboardApi, DASHBOARD_WINDOWS, type DashboardWindow, type WorkspaceDashboard } from "@/api/dashboard";
import { PageMetadata } from "@/components/common/PageMetadata";

type LoadState =
  | { status: "loading" }
  | { status: "error"; code: string }
  | { status: "ready"; dashboard: WorkspaceDashboard };

/**
 * The workspace overview.
 *
 * Every number shown here was measured. Where a feature has produced nothing, the card says which
 * of the two reasons applies — nothing happened, or nothing can happen yet — because a zero that
 * means "no visitors" and a zero that means "no form exists" ask for different actions.
 *
 * The site filter defaults to every site, which is the question someone opening a dashboard is
 * asking. Narrowing to one site re-asks the server rather than filtering what is already loaded:
 * the page list for a site is a ranking over that site's rows, not a subset of the workspace's.
 */
export function DashboardPage({ workspaceId }: { workspaceId: string }) {
  const { t, i18n } = useTranslation(["dashboard", "errors", "common"]);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [days, setDays] = useState<DashboardWindow>(30);
  const [projectId, setProjectId] = useState("");

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: "loading" });
      try {
        const dashboard = await dashboardApi.load(workspaceId, {
          days,
          ...(projectId === "" ? {} : { projectId }),
          ...(signal ? { signal } : {}),
        });
        setState({ status: "ready", dashboard });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error", code: error instanceof ApiError ? error.code : "INTERNAL_ERROR" });
      }
    },
    [workspaceId, days, projectId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    // A slow answer for the previous filter must not land on top of the current one.
    return () => controller.abort();
  }, [load]);

  const number = new Intl.NumberFormat(i18n.language);

  return (
    <div className="px-6 py-10 sm:px-10">
      <PageMetadata title={`${t("dashboard:overview.title")} — ${t("common:productName")}`} />

      <div className="mx-auto max-w-4xl">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-950">
          {t("dashboard:overview.title")}
        </h1>
        <p className="mt-1 text-sm text-ink-600">{t("dashboard:overview.description")}</p>

        {state.status === "loading" && (
          <p role="status" className="mt-8 rounded-lg border border-ink-100 p-8 text-center text-ink-500">
            {t("dashboard:overview.loading")}
          </p>
        )}

        {state.status === "error" && (
          <div role="alert" className="mt-8 rounded-lg border border-red-200 bg-red-50 p-6">
            <h2 className="font-medium text-red-900">{t("dashboard:overview.error.title")}</h2>
            <p className="mt-1 text-sm text-red-800">{t(`errors:${state.code}` as "errors:INTERNAL_ERROR")}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-4 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-900"
            >
              {t("dashboard:overview.error.retry")}
            </button>
          </div>
        )}

        {state.status === "ready" && (
          <Overview
            dashboard={state.dashboard}
            days={days}
            projectId={projectId}
            onDaysChange={setDays}
            onProjectChange={setProjectId}
            format={(value) => number.format(value)}
            workspaceId={workspaceId}
          />
        )}
      </div>
    </div>
  );
}

function Overview({
  dashboard,
  days,
  projectId,
  onDaysChange,
  onProjectChange,
  format,
  workspaceId,
}: {
  dashboard: WorkspaceDashboard;
  days: DashboardWindow;
  projectId: string;
  onDaysChange: (days: DashboardWindow) => void;
  onProjectChange: (projectId: string) => void;
  format: (value: number) => string;
  workspaceId: string;
}) {
  const { t } = useTranslation(["dashboard", "common"]);

  // Sites that received traffic, plus every recent site, so a site with no visits can still be
  // selected — which is exactly when someone wants to check whether it is being found at all.
  const selectable = [
    ...dashboard.traffic.bySite.map((site) => ({ id: site.projectId, name: site.siteName })),
    ...dashboard.recentSites.map((site) => ({ id: site.id, name: site.name })),
  ].filter((site, index, all) => site.name !== "" && all.findIndex((other) => other.id === site.id) === index);

  return (
    <>
      <div className="mt-6 flex flex-wrap gap-3">
        <label className="text-xs font-medium text-ink-600">
          {t("dashboard:overview.filters.site")}
          <select
            value={projectId}
            onChange={(event) => onProjectChange(event.target.value)}
            className="mt-1 block min-w-48 rounded-md border border-ink-200 px-2 py-1.5 text-sm text-ink-900"
          >
            <option value="">{t("dashboard:overview.filters.allSites")}</option>
            {selectable.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-medium text-ink-600">
          {t("dashboard:overview.filters.period")}
          <select
            value={days}
            onChange={(event) => onDaysChange(Number(event.target.value) as DashboardWindow)}
            className="mt-1 block rounded-md border border-ink-200 px-2 py-1.5 text-sm text-ink-900"
          >
            {DASHBOARD_WINDOWS.map((window) => (
              <option key={window} value={window}>
                {t("dashboard:overview.filters.lastDays", { count: window })}
              </option>
            ))}
          </select>
        </label>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric
          label={t("dashboard:overview.metrics.views")}
          value={format(dashboard.traffic.totalViews)}
          hint={t("dashboard:overview.filters.lastDays", { count: dashboard.traffic.days })}
        />
        <Metric label={t("dashboard:overview.metrics.sites")} value={format(dashboard.sites.total)} />
        <Metric label={t("dashboard:overview.metrics.pages")} value={format(dashboard.content.pages)} />
        <Metric
          label={t("dashboard:overview.metrics.submissions")}
          value={dashboard.forms.state === "no_forms" ? "—" : format(dashboard.forms.submissions)}
          hint={
            dashboard.forms.state === "no_forms"
              ? t("dashboard:overview.metrics.noForms")
              : t("dashboard:overview.metrics.unread", { count: dashboard.forms.unread })
          }
        />
      </dl>

      <TrafficChart byDay={dashboard.traffic.byDay} format={format} />

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold text-ink-950">{t("dashboard:overview.pages.title")}</h2>
        {dashboard.traffic.topPages.length === 0 ? (
          <p className="mt-2 rounded-lg border border-ink-100 p-6 text-center text-sm text-ink-500">
            {t("dashboard:overview.pages.empty")}
          </p>
        ) : (
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th scope="col" className="py-2">
                  {t("dashboard:overview.pages.page")}
                </th>
                {projectId === "" && (
                  <th scope="col" className="py-2">
                    {t("dashboard:overview.pages.site")}
                  </th>
                )}
                <th scope="col" className="py-2 text-right">
                  {t("dashboard:overview.metrics.views")}
                </th>
              </tr>
            </thead>
            <tbody>
              {dashboard.traffic.topPages.map((page) => (
                <tr key={`${page.projectId}${page.path}`} className="border-t border-ink-100">
                  <td className="py-2 font-medium text-ink-900">{page.path}</td>
                  {projectId === "" && <td className="py-2 text-ink-600">{page.siteName}</td>}
                  <td className="py-2 text-right tabular-nums text-ink-900">{format(page.views)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold text-ink-950">{t("dashboard:overview.sites.title")}</h2>
        {dashboard.recentSites.length === 0 ? (
          <p className="mt-2 rounded-lg border border-ink-100 p-6 text-center text-sm text-ink-500">
            {t("dashboard:sites.empty.title")}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-ink-100">
            {dashboard.recentSites.map((site) => (
              <li key={site.id} className="flex items-center justify-between gap-4 py-2">
                <Link to={`/app/${workspaceId}/sites/${site.id}/dashboard`} className="text-sm font-medium text-ink-900">
                  {site.name}
                </Link>
                <span className="text-sm tabular-nums text-ink-600">
                  {format(dashboard.traffic.bySite.find((row) => row.projectId === site.id)?.views ?? 0)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-ink-100 p-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink-950">{value}</dd>
      {hint !== undefined && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

/**
 * Daily views as bars.
 *
 * Plain elements rather than a charting library: the shape is one number per day, and a dependency
 * that renders it would be larger than the page it sits on. The table beside it is what a screen
 * reader gets, so the bars are hidden from the accessibility tree instead of being given labels
 * nobody can act on.
 */
function TrafficChart({ byDay, format }: { byDay: Array<{ day: string; views: number }>; format: (n: number) => string }) {
  const { t } = useTranslation("dashboard");
  const peak = Math.max(1, ...byDay.map((day) => day.views));

  return (
    <section className="mt-8">
      <h2 className="font-display text-lg font-semibold text-ink-950">{t("overview.chart.title")}</h2>
      <div aria-hidden className="mt-3 flex h-32 items-end gap-px rounded-lg border border-ink-100 p-3">
        {byDay.map((day) => (
          <div
            key={day.day}
            title={`${day.day}: ${format(day.views)}`}
            style={{ height: `${Math.max(2, Math.round((day.views / peak) * 100))}%` }}
            className="flex-1 rounded-sm bg-accent-600/80"
          />
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-500">
        {t("overview.chart.summary", { peak: format(peak), days: byDay.length })}
      </p>
    </section>
  );
}
