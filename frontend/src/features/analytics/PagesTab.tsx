import { useTranslation } from "react-i18next";

import { analyticsApi, type AnalyticsFilters, type AnalyticsPages } from "@/api/analytics";
import { AnalyticsState } from "./primitives";
import { useAnalyticsResource } from "./useAnalyticsResource";

/** Which pages were read, how far down, and how often something on them was clicked. */
export function AnalyticsPagesTab({
  workspaceId,
  projectId,
  filters,
}: {
  workspaceId: string;
  projectId: string;
  filters: AnalyticsFilters;
}) {
  const { t, i18n } = useTranslation("analytics");
  const state = useAnalyticsResource<AnalyticsPages>(
    (signal) => analyticsApi.pages(workspaceId, projectId, filters, { signal }),
    [workspaceId, projectId, filters.days, filters.device],
  );

  if (state.status !== "ready") return <AnalyticsState state={state} />;

  const number = new Intl.NumberFormat(i18n.language);

  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-ink-950">{t("pages.title")}</h2>
        {/* A plain link rather than a fetch: the JSON client parses every body, and a spreadsheet
            is not JSON. The browser downloads it with the session it already has. */}
        <a
          href={analyticsApi.exportUrl(workspaceId, projectId, filters)}
          className="rounded-md border border-ink-200 px-3 py-1.5 text-sm font-medium text-ink-700"
        >
          {t("pages.export")}
        </a>
      </div>

      {state.data.pages.length === 0 ? (
        <p className="mt-3 rounded-lg border border-ink-100 p-6 text-center text-sm text-ink-500">
          {t("states.empty")}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th scope="col" className="py-2">{t("pages.page")}</th>
                <th scope="col" className="py-2 text-right">{t("pages.views")}</th>
                <th scope="col" className="py-2 text-right">{t("pages.clicks")}</th>
                <th scope="col" className="py-2 text-right">{t("pages.reachedHalf")}</th>
                <th scope="col" className="py-2 text-right">{t("pages.reachedEnd")}</th>
              </tr>
            </thead>
            <tbody>
              {state.data.pages.map((page) => (
                <tr key={page.pageId} className="border-t border-ink-100">
                  <td className="py-2 font-medium text-ink-900">{page.path}</td>
                  <td className="py-2 text-right tabular-nums">{number.format(page.views)}</td>
                  <td className="py-2 text-right tabular-nums">{number.format(page.clicks)}</td>
                  <td className="py-2 text-right tabular-nums">{number.format(page.scroll["50"] ?? 0)}</td>
                  <td className="py-2 text-right tabular-nums">{number.format(page.scroll["90"] ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
