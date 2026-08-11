import { useTranslation } from "react-i18next";

import { analyticsApi, type AnalyticsFilters, type AnalyticsVitals } from "@/api/analytics";
import { AnalyticsState } from "./primitives";
import { useAnalyticsResource } from "./useAnalyticsResource";

/**
 * Core Web Vitals from real visitors.
 *
 * A metric below the sample threshold shows its count and no rating. A rating drawn from a handful
 * of visits is noise wearing a badge, and a green badge someone stops checking is worse than an
 * honest "not yet".
 */
export function AnalyticsVitalsTab({
  workspaceId,
  projectId,
  filters,
}: {
  workspaceId: string;
  projectId: string;
  filters: AnalyticsFilters;
}) {
  const { t, i18n } = useTranslation("analytics");
  const state = useAnalyticsResource<AnalyticsVitals>(
    (signal) => analyticsApi.vitals(workspaceId, projectId, filters, { signal }),
    [workspaceId, projectId, filters.days, filters.device],
  );

  if (state.status !== "ready") return <AnalyticsState state={state} />;

  const number = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 });

  return (
    <section className="mt-6">
      <h2 className="font-display text-lg font-semibold text-ink-950">{t("vitals.title")}</h2>
      <p className="mt-1 text-sm text-ink-600">{t("vitals.description")}</p>

      {state.data.metrics.length === 0 ? (
        <p className="mt-3 rounded-lg border border-ink-100 p-6 text-center text-sm text-ink-500">
          {t("vitals.empty")}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th scope="col" className="py-2">{t("vitals.metric")}</th>
                <th scope="col" className="py-2">{t("vitals.device")}</th>
                <th scope="col" className="py-2 text-right">{t("vitals.samples")}</th>
                <th scope="col" className="py-2 text-right">{t("vitals.value")}</th>
                <th scope="col" className="py-2">{t("vitals.rating")}</th>
              </tr>
            </thead>
            <tbody>
              {state.data.metrics.map((entry) => (
                <tr key={`${entry.metric}${entry.device}`} className="border-t border-ink-100">
                  <td className="py-2 font-medium text-ink-900">{entry.metric}</td>
                  <td className="py-2 text-ink-600">{t(`filters.${entry.device}`)}</td>
                  <td className="py-2 text-right tabular-nums">{entry.samples}</td>
                  <td className="py-2 text-right tabular-nums">
                    {entry.p75 === null ? "—" : number.format(entry.p75)}
                  </td>
                  <td className="py-2">
                    {entry.rating === null ? (
                      <span className="text-xs text-ink-500">
                        {t("vitals.insufficient", { count: entry.samples, needed: state.data.minimumSamples })}
                      </span>
                    ) : (
                      // The word, not only the colour. A rating that exists solely as a hue is
                      // unreadable to anyone who cannot distinguish it.
                      <span className="text-xs font-medium text-ink-900">{t(`vitals.ratings.${entry.rating}`)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
