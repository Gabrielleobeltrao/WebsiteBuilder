import { useTranslation } from "react-i18next";

import { analyticsApi, type AnalyticsFilters, type AnalyticsOverview } from "@/api/analytics";
import { useAnalyticsResource } from "./useAnalyticsResource";
import { AnalyticsState, Metric, MetricGrid } from "./primitives";

/**
 * The overview.
 *
 * Two view counts appear side by side and that is deliberate. The server counts every visitor; the
 * browser counts the ones who ran the tracker, which excludes anyone who blocks scripts, disables
 * JavaScript or declines consent. Showing only the second would present a subset as the whole;
 * showing only the first would hide that the rest of this page describes that subset. Their ratio is
 * the coverage figure, which is the honest way to read everything below it.
 */
export function AnalyticsOverviewTab({
  workspaceId,
  projectId,
  filters,
}: {
  workspaceId: string;
  projectId: string;
  filters: AnalyticsFilters;
}) {
  const { t, i18n } = useTranslation("analytics");
  const state = useAnalyticsResource<AnalyticsOverview>(
    (signal) => analyticsApi.overview(workspaceId, projectId, filters, { signal }),
    [workspaceId, projectId, filters.days, filters.device],
  );

  if (state.status !== "ready") return <AnalyticsState state={state} />;

  const data = state.data;
  const number = new Intl.NumberFormat(i18n.language);
  const percent = (value: number, of: number) =>
    of === 0 ? "—" : `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format((value / of) * 100)}%`;

  const seconds = (ms: number, sessions: number) =>
    sessions === 0 ? "—" : `${Math.round(ms / sessions / 1000)}s`;

  if (data.sessions === 0 && data.serverViews === 0) {
    return (
      <div className="mt-8 rounded-lg border border-ink-100 p-8 text-center">
        <h2 className="font-medium text-ink-900">{t("states.collecting.title")}</h2>
        <p className="mt-1 text-sm text-ink-600">{t("states.collecting.description")}</p>
      </div>
    );
  }

  return (
    <>
      <MetricGrid>
        <Metric label={t("metrics.serverViews")} value={number.format(data.serverViews)} />
        <Metric
          label={t("metrics.browserViews")}
          value={number.format(data.browserViews)}
          hint={`${t("metrics.coverage")}: ${percent(data.browserViews, data.serverViews)}`}
        />
        <Metric
          label={t("metrics.sessions")}
          value={number.format(data.sessions)}
          hint={
            data.comparison === null
              ? t("metrics.noComparison")
              : `${data.comparison.sessions >= 0 ? "" : ""}${number.format(data.comparison.sessions)} ${t("metrics.comparison")}`
          }
        />
        <Metric label={t("metrics.clicks")} value={number.format(data.clicks)} />
        <Metric
          label={t("metrics.engagement")}
          value={percent(data.engagedSessions, data.sessions)}
          hint={t("definitions.engaged")}
        />
        <Metric
          label={t("metrics.bounce")}
          value={percent(data.bounces, data.sessions)}
          hint={t("definitions.bounce")}
        />
        <Metric
          label={t("metrics.engagedTime")}
          value={seconds(data.engagedMs, data.sessions)}
          hint={t("definitions.engagedTime")}
        />
      </MetricGrid>

      <p className="mt-2 text-xs text-ink-500">{t("metrics.coverageHint")}</p>

      <Section title={t("charts.overTime")}>
        <DailyBars
          days={data.byDay}
          label={(day) => `${day.day}: ${number.format(day.sessions)} / ${number.format(day.views)}`}
        />
      </Section>

      <Breakdown title={t("charts.devices")} rows={data.byDevice.map((row) => [row.device, row.sessions])} />
      <Breakdown title={t("charts.sources")} rows={data.bySource.map((row) => [row.source, row.sessions])} />
      <Breakdown title={t("charts.hosts")} rows={data.byHost.map((row) => [row.host, row.sessions])} />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-lg font-semibold text-ink-950">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Bars are decoration; the table beside them is the data.
 *
 * A chart nobody can read with a screen reader is not a chart, and labelling a hundred bars
 * individually produces an unusable tab order. The visual is hidden from assistive technology and
 * the same numbers are available as text.
 */
function DailyBars({
  days,
  label,
}: {
  days: Array<{ day: string; sessions: number; views: number }>;
  label: (day: { day: string; sessions: number; views: number }) => string;
}) {
  const peak = Math.max(1, ...days.map((day) => day.sessions));

  return (
    <>
      <div aria-hidden className="mt-3 flex h-28 items-end gap-px rounded-lg border border-ink-100 p-3">
        {days.map((day) => (
          <div
            key={day.day}
            title={label(day)}
            style={{ height: `${Math.max(2, Math.round((day.sessions / peak) * 100))}%` }}
            className="flex-1 rounded-sm bg-accent-600/80"
          />
        ))}
      </div>
      <details className="mt-2 text-sm text-ink-600">
        <summary className="cursor-pointer">{days.length}</summary>
        <ul className="mt-2 space-y-1">
          {days.map((day) => (
            <li key={day.day} className="tabular-nums">
              {label(day)}
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}

function Breakdown({ title, rows }: { title: string; rows: Array<[string, number]> }) {
  const { t } = useTranslation("analytics");
  const total = rows.reduce((sum, [, count]) => sum + count, 0);

  return (
    <Section title={title}>
      {rows.length === 0 ? (
        <p className="mt-2 rounded-lg border border-ink-100 p-6 text-center text-sm text-ink-500">
          {t("states.empty")}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-ink-100">
          {rows.map(([name, count]) => (
            <li key={name} className="flex items-center justify-between gap-4 py-2 text-sm">
              <span className="text-ink-900">{name}</span>
              <span className="tabular-nums text-ink-600">
                {count} · {total === 0 ? "0" : Math.round((count / total) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
