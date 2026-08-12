import { API_BASE_PATH, DEVICE_ORDER, deviceReferenceWidth, type DeviceMode } from "@websitebuilder/shared";
import { ArrowLeft } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router";

import { PageMetadata } from "@/components/common/PageMetadata";
import { useAuthoringCapability } from "@/features/editor/useAuthoringCapability";

/**
 * Clean preview of the saved draft.
 *
 * The page itself is not rendered by this component: it is served as a complete document by the
 * authenticated draft-preview route and framed here. That is what makes preview a rehearsal rather
 * than a second implementation — the frame runs its own layout at a real device width, so media
 * queries, viewport units and scrolling behave the way they will for a visitor, which a scaled-down
 * div in the application's own document can never do.
 *
 * This shell owns exactly three things: Back, the three devices, and the scale that fits the frame
 * on the screen it is being viewed on. No diagnostics, no width slider, no save.
 */
export function PreviewRoute() {
  const { t } = useTranslation(["builder", "common"]);
  const { workspaceId = "", projectId = "", "*": trailing = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const capability = useAuthoringCapability();
  const frameRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<number | null>(null);

  const requested = searchParams.get("device");
  const device: DeviceMode =
    requested === "desktop" || requested === "tablet" || requested === "mobile"
      ? requested
      : // A phone opens on the phone layout: the desktop rendering scaled to a 390 px screen is
        // legible to nobody and is not what the person holding it is asking about.
        capability.canAuthor
        ? "desktop"
        : "mobile";

  const referenceWidth = deviceReferenceWidth(device);
  const path = trailing === "" ? "/" : `/${trailing}`;
  const source = `${API_BASE_PATH}/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(
    projectId,
  )}/publishing/preview?path=${encodeURIComponent(path)}`;

  // Measured rather than assumed: the scale has to answer "does this fit on *this* screen", and the
  // window is not the frame's container.
  useLayoutEffect(() => {
    const node = frameRef.current;
    if (node === null) return;

    const measure = () => setAvailable(node.clientWidth);
    measure();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (requested === null && !capability.canAuthor) {
      const params = new URLSearchParams(searchParams);
      params.set("device", "mobile");
      setSearchParams(params, { replace: true });
    }
  }, [requested, capability.canAuthor, searchParams, setSearchParams]);

  /**
   * The frame keeps its device width and is scaled to fit; it is never given a smaller width.
   * Handing it the host's width instead would be the bug this whole route exists to remove — the
   * preview would then be showing a layout at a width no device has.
   */
  const scale = available === null || available === 0 ? 1 : Math.min(1, available / referenceWidth);
  const frameHeight = Math.max(400, (window.innerHeight - 120) / scale);

  return (
    <div className="flex h-dvh flex-col bg-ink-100">
      <PageMetadata title={t("builder:preview.title")} />

      <header className="flex items-center justify-between gap-4 border-b border-ink-200 bg-white px-4 py-2">
        <Link
          to={`/app/${workspaceId}/sites/${projectId}/builder`}
          className="flex items-center gap-1.5 text-xs font-medium text-ink-700"
        >
          <ArrowLeft aria-hidden className="size-4" />
          {t("builder:preview.back")}
        </Link>

        <div role="group" aria-label={t("builder:responsive.device")} className="flex gap-1">
          {DEVICE_ORDER.map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={device === candidate}
              onClick={() => {
                const params = new URLSearchParams(searchParams);
                params.set("device", candidate);
                setSearchParams(params, { replace: true });
              }}
              className={[
                "rounded-md px-3 py-1.5 text-xs font-medium",
                device === candidate ? "bg-ink-900 text-white" : "border border-ink-200 text-ink-700",
              ].join(" ")}
            >
              {t(`builder:responsive.preset.${candidate}`)}
            </button>
          ))}
        </div>
      </header>

      <div ref={frameRef} className="flex min-h-0 flex-1 justify-center overflow-auto p-4">
        {/* Reserves the scaled size so the surrounding layout is not overlapped by a frame that is
            visually smaller than the box it occupies. */}
        <div style={{ width: referenceWidth * scale, height: frameHeight * scale }}>
          <iframe
            title={t("builder:preview.frame")}
            src={source}
            style={{
              width: referenceWidth,
              height: frameHeight,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              border: "none",
              backgroundColor: "white",
            }}
          />
        </div>
      </div>
    </div>
  );
}
