import { ANALYTICS_WINDOWS, DEVICE_CATEGORIES, type AnalyticsSettings, type DeviceCategory } from "@websitebuilder/shared";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useSearchParams } from "react-router";

import { ApiError } from "@/api/client";
import { analyticsApi, type AnalyticsFilters } from "@/api/analytics";
import { PageMetadata } from "@/components/common/PageMetadata";
import { AnalyticsOverviewTab } from "./OverviewTab";
import { AnalyticsHeatmapTab } from "./HeatmapTab";
import { AnalyticsPagesTab } from "./PagesTab";
import { AnalyticsSettingsTab } from "./SettingsTab";
import { AnalyticsVitalsTab } from "./VitalsTab";

const TABS = ["overview", "pages", "heatmap", "vitals", "settings"] as const;
type Tab = (typeof TABS)[number];

type SettingsState =
  | { status: "loading" }
  | { status: "error"; code: string }
  | { status: "ready"; settings: AnalyticsSettings };

/**
 * Analytics for one published site.
 *
 * Filter state lives in the URL, so a view can be reloaded, bookmarked and handed to a colleague who
 * has access — a dashboard whose state exists only in memory cannot be pointed at.
 *
 * The page is gated on settings rather than on data: a site that is not collecting has no numbers to
 * show and no honest way to show zero, so it gets an explanation and a way to turn measurement on.
 */
export function AnalyticsRoute() {
  const { t } = useTranslation(["analytics", "errors", "common"]);
  const { workspaceId = "", projectId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState<SettingsState>({ status: "loading" });

  const tab = (TABS.find((candidate) => candidate === params.get("tab")) ?? "overview") as Tab;
  const days = Number(params.get("days") ?? 30);
  const device = DEVICE_CATEGORIES.find((candidate) => candidate === params.get("device"));
  const filters: AnalyticsFilters = {
    days: ANALYTICS_WINDOWS.includes(days as (typeof ANALYTICS_WINDOWS)[number]) ? days : 30,
    ...(device === undefined ? {} : { device }),
  };

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  };

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: "loading" });
      try {
        const settings = await analyticsApi.loadSettings(workspaceId, projectId, signal ? { signal } : {});
        setState({ status: "ready", settings });
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

  return (
    <div className="px-6 py-10 sm:px-10">
      <PageMetadata title={`${t("analytics:title")} — ${t("common:productName")}`} />

      <div className="mx-auto max-w-4xl">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-950">{t("analytics:title")}</h1>
        <p className="mt-1 text-sm text-ink-600">{t("analytics:description")}</p>

        {state.status === "loading" && (
          <p role="status" className="mt-8 rounded-lg border border-ink-100 p-8 text-center text-ink-500">
            {t("analytics:loading")}
          </p>
        )}

        {state.status === "error" && (
          <div role="alert" className="mt-8 rounded-lg border border-red-200 bg-red-50 p-6">
            <h2 className="font-medium text-red-900">{t("analytics:error.title")}</h2>
            <p className="mt-1 text-sm text-red-800">{t(`errors:${state.code}` as "errors:INTERNAL_ERROR")}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-4 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-900"
            >
              {t("analytics:error.retry")}
            </button>
          </div>
        )}

        {state.status === "ready" && (
          <>
            <nav aria-label={t("analytics:title")} className="mt-6 border-b border-ink-100">
              <ul className="flex flex-wrap gap-1">
                {TABS.map((candidate) => (
                  <li key={candidate}>
                    <button
                      type="button"
                      onClick={() => update({ tab: candidate })}
                      aria-current={candidate === tab ? "page" : undefined}
                      className={[
                        "rounded-t-md px-3 py-2 text-sm font-medium",
                        candidate === tab ? "border-b-2 border-accent-600 text-ink-900" : "text-ink-600",
                      ].join(" ")}
                    >
                      {t(`analytics:tabs.${candidate}`)}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>

            {!state.settings.enabled && tab !== "settings" ? (
              <Disabled onOpenSettings={() => update({ tab: "settings" })} />
            ) : (
              <>
                {tab !== "settings" && (
                  <FilterBar
                    days={filters.days ?? 30}
                    device={device}
                    onChange={(changes) => update(changes)}
                  />
                )}

                {tab === "overview" && (
                  <AnalyticsOverviewTab workspaceId={workspaceId} projectId={projectId} filters={filters} />
                )}
                {tab === "pages" && (
                  <AnalyticsPagesTab workspaceId={workspaceId} projectId={projectId} filters={filters} />
                )}
                {tab === "heatmap" && (
                  <AnalyticsHeatmapTab
                    workspaceId={workspaceId}
                    projectId={projectId}
                    versionId={params.get("version") ?? undefined}
                    device={device}
                    onVersionChange={(version) => update({ version })}
                  />
                )}
                {tab === "vitals" && (
                  <AnalyticsVitalsTab workspaceId={workspaceId} projectId={projectId} filters={filters} />
                )}
                {tab === "settings" && (
                  <AnalyticsSettingsTab
                    workspaceId={workspaceId}
                    projectId={projectId}
                    settings={state.settings}
                    onSaved={(settings) => setState({ status: "ready", settings })}
                  />
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * What a site that measures nothing shows.
 *
 * Not an empty chart. A zero and "nobody is counting" look identical on a dashboard and mean
 * opposite things, and only one of them is something the reader can act on.
 */
function Disabled({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t } = useTranslation("analytics");
  return (
    <div className="mt-8 rounded-lg border border-ink-200 bg-ink-50 p-8 text-center">
      <h2 className="font-display text-lg font-semibold text-ink-950">{t("states.disabled.title")}</h2>
      <p className="mx-auto mt-2 max-w-prose text-sm text-ink-600">{t("states.disabled.description")}</p>
      <button
        type="button"
        onClick={onOpenSettings}
        className="mt-4 rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700"
      >
        {t("states.disabled.action")}
      </button>
    </div>
  );
}

function FilterBar({
  days,
  device,
  onChange,
}: {
  days: number;
  device: DeviceCategory | undefined;
  onChange: (changes: Record<string, string | null>) => void;
}) {
  const { t } = useTranslation("analytics");

  return (
    <div className="mt-6 flex flex-wrap gap-3">
      <label className="text-xs font-medium text-ink-600">
        {t("filters.period")}
        <select
          value={days}
          onChange={(event) => onChange({ days: event.target.value })}
          className="mt-1 block rounded-md border border-ink-200 px-2 py-1.5 text-sm text-ink-900"
        >
          {ANALYTICS_WINDOWS.map((window) => (
            <option key={window} value={window}>
              {t("filters.lastDays", { count: window })}
            </option>
          ))}
        </select>
      </label>

      <label className="text-xs font-medium text-ink-600">
        {t("filters.device")}
        <select
          value={device ?? ""}
          onChange={(event) => onChange({ device: event.target.value === "" ? null : event.target.value })}
          className="mt-1 block rounded-md border border-ink-200 px-2 py-1.5 text-sm text-ink-900"
        >
          <option value="">{t("filters.allDevices")}</option>
          {DEVICE_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {t(`filters.${category}`)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
