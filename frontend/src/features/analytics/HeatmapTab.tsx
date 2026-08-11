import {
  CLICK_GRID_COLUMNS,
  CLICK_GRID_ROWS,
  DEVICE_CATEGORIES,
  HEATMAP_MODES,
  type BuilderPage,
  type DeviceCategory,
  type HeatmapMode,
} from "@websitebuilder/shared";
import { ProjectPageRenderer, RendererContext } from "@websitebuilder/frontend/renderer";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { analyticsApi, type AnalyticsHeatmap, type AnalyticsSnapshot } from "@/api/analytics";
import { publishingApi } from "@/api/publishing";
import { AnalyticsState } from "./primitives";
import { useAnalyticsResource } from "./useAnalyticsResource";

/**
 * Where visitors clicked, how far they read, and what held their attention.
 *
 * The layout underneath is the exact published version the coordinates were recorded against,
 * rendered by the same component that produced the page — so alignment holds by construction rather
 * than by matching two implementations. It is not the live site in a frame: published pages set
 * `frame-ancestors 'none'`, and a cross-origin frame could not be measured for alignment anyway.
 *
 * One page, one version, one device. Anything else is a picture drawn from two layouts that looks
 * authoritative and describes nothing that ever existed, so the reader is asked to narrow instead.
 */
export function AnalyticsHeatmapTab({
  workspaceId,
  projectId,
  versionId: requested,
  device,
  onVersionChange,
}: {
  workspaceId: string;
  projectId: string;
  versionId: string | undefined;
  device: DeviceCategory | undefined;
  onVersionChange: (versionId: string) => void;
}) {
  const { t } = useTranslation("analytics");
  const [mode, setMode] = useState<HeatmapMode>("click");
  const [pageId, setPageId] = useState<string>("");

  // Which layouts still exist. Heatmap data is deleted with the version it describes, so this list
  // is also the list of maps that can still be drawn.
  const versions = useAnalyticsResource(
    (signal) => publishingApi.history(workspaceId, projectId, { signal }),
    [workspaceId, projectId],
  );
  const available = versions.status === "ready" ? versions.data : [];
  const versionId = requested ?? available[0]?.id;

  const snapshot = useAnalyticsResource<AnalyticsSnapshot | null>(
    (signal) =>
      versionId === undefined
        ? Promise.resolve(null)
        : analyticsApi.snapshot(workspaceId, projectId, versionId, { signal }),
    [workspaceId, projectId, versionId],
  );

  const ready = snapshot.status === "ready" && snapshot.data !== null;
  const selectedPage = ready ? (pageId === "" ? (snapshot.data?.pages[0]?.pageId ?? "") : pageId) : "";
  const complete = ready && selectedPage !== "" && versionId !== undefined && device !== undefined;

  const heatmap = useAnalyticsResource<AnalyticsHeatmap | null>(
    (signal) =>
      complete
        ? analyticsApi.heatmap(
            workspaceId,
            projectId,
            { mode, pageId: selectedPage, versionId, device },
            { signal },
          )
        : Promise.resolve(null),
    [workspaceId, projectId, mode, selectedPage, versionId, device, complete],
  );

  if (snapshot.status === "error") return <AnalyticsState state={snapshot} />;

  return (
    <section className="mt-6">
      <h2 className="font-display text-lg font-semibold text-ink-950">{t("heatmap.title")}</h2>

      <div className="mt-4 flex flex-wrap gap-3">
        <label className="text-xs font-medium text-ink-600">
          {t("heatmap.mode")}
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as HeatmapMode)}
            className="mt-1 block rounded-md border border-ink-200 px-2 py-1.5 text-sm text-ink-900"
          >
            {HEATMAP_MODES.map((candidate) => (
              <option key={candidate} value={candidate}>
                {t(`heatmap.modes.${candidate}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-medium text-ink-600">
          {t("heatmap.version")}
          <select
            value={versionId ?? ""}
            onChange={(event) => onVersionChange(event.target.value)}
            disabled={available.length === 0}
            className="mt-1 block rounded-md border border-ink-200 px-2 py-1.5 text-sm text-ink-900"
          >
            {available.map((version) => (
              <option key={version.id} value={version.id}>
                {`v${version.version} · ${new Date(version.createdAt).toLocaleDateString()}`}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-medium text-ink-600">
          {t("heatmap.page")}
          <select
            value={selectedPage}
            onChange={(event) => setPageId(event.target.value)}
            disabled={!ready}
            className="mt-1 block rounded-md border border-ink-200 px-2 py-1.5 text-sm text-ink-900"
          >
            {(snapshot.status === "ready" ? (snapshot.data?.pages ?? []) : []).map((page) => (
              <option key={page.pageId} value={page.pageId}>
                {page.path}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!complete ? (
        // The refusal is the feature, and it says which choice is missing rather than drawing
        // something that would be wrong.
        <p className="mt-6 rounded-lg border border-ink-200 bg-ink-50 p-6 text-center text-sm text-ink-700">
          {t("heatmap.narrow")}
        </p>
      ) : heatmap.status !== "ready" || heatmap.data === null ? (
        <AnalyticsState state={heatmap} />
      ) : (
        <Overlay
          data={heatmap.data}
          page={pageOf(snapshot.status === "ready" ? snapshot.data : null, selectedPage)}
          deviceLabel={t(`filters.${device}`)}
        />
      )}
    </section>
  );
}

function pageOf(snapshot: AnalyticsSnapshot | null, pageId: string): BuilderPage | null {
  const document = snapshot?.document as { pages?: BuilderPage[] } | undefined;
  return document?.pages?.find((page) => page.id === pageId) ?? null;
}

function Overlay({
  data,
  page,
  deviceLabel,
}: {
  data: AnalyticsHeatmap;
  page: BuilderPage | null;
  deviceLabel: string;
}) {
  const { t } = useTranslation("analytics");
  const peak = Math.max(1, ...data.cells.map((cell) => cell.count));

  return (
    <>
      <p className="mt-4 text-sm text-ink-600">
        {t("heatmap.samples", { count: data.samples })} · {deviceLabel}
      </p>

      {data.samples === 0 ? (
        <p className="mt-3 rounded-lg border border-ink-100 p-6 text-center text-sm text-ink-500">
          {t("heatmap.insufficient")}
        </p>
      ) : (
        <div className="relative mt-3 overflow-hidden rounded-lg border border-ink-200">
          {/* The published layout, rendered by the renderer itself. Inert: nothing here navigates. */}
          <div aria-hidden className="pointer-events-none origin-top-left" style={{ transform: "scale(0.5)", width: "200%" }}>
            {page === null ? null : (
              <RendererContext.Provider value={{ resolvePagePath: () => null, resolveMediaUrl: () => "" }}>
                <ProjectPageRenderer page={page} />
              </RendererContext.Provider>
            )}
          </div>

          <div aria-hidden className="absolute inset-0">
            {data.mode === "click" &&
              data.cells.map((cell) => {
                const [column, row] = cell.key.split(":").map(Number);
                return (
                  <div
                    key={cell.key}
                    style={{
                      position: "absolute",
                      left: `${((column ?? 0) / CLICK_GRID_COLUMNS) * 100}%`,
                      top: `${((row ?? 0) / CLICK_GRID_ROWS) * 100}%`,
                      width: `${100 / CLICK_GRID_COLUMNS}%`,
                      height: `${100 / CLICK_GRID_ROWS}%`,
                      backgroundColor: `rgba(239, 68, 68, ${Math.min(0.85, cell.count / peak)})`,
                    }}
                  />
                );
              })}
          </div>
        </div>
      )}

      {/* The table is the accessible form of the same data, and the only form on a screen too
          narrow to render a desktop layout usefully. */}
      <h3 className="mt-6 text-sm font-semibold text-ink-900">{t("heatmap.table")}</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th scope="col" className="py-2">{t("heatmap.area")}</th>
              <th scope="col" className="py-2 text-right">{t("heatmap.count")}</th>
            </tr>
          </thead>
          <tbody>
            {[...data.cells]
              .sort((left, right) => right.count - left.count)
              .slice(0, 20)
              .map((cell) => (
                <tr key={cell.key} className="border-t border-ink-100">
                  <td className="py-2 font-medium text-ink-900">{cell.key}</td>
                  <td className="py-2 text-right tabular-nums">{cell.count}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <p className="sr-only">{DEVICE_CATEGORIES.join(", ")}</p>
    </>
  );
}
