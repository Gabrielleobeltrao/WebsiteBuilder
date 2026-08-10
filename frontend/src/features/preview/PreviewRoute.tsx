import { findPageBySlug, pagePath, type BuilderProject } from "@websitebuilder/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useSearchParams } from "react-router";

import { ApiError } from "@/api/client";
import { projectsApi } from "@/api/projects";
import { PageMetadata } from "@/components/common/PageMetadata";
import { ProjectPageRenderer } from "@/components/renderer/ProjectPageRenderer";
import { RendererContext, type RendererContextValue } from "@/components/renderer/RendererContext";
import { MOBILE_PREVIEW_WIDTH } from "@websitebuilder/shared";

/**
 * Clean preview of a saved project.
 *
 * It mounts the shared renderer and nothing else: no editor chrome, no selection layer, no
 * mutation path. Internal links navigate inside the preview rather than opening the editor, which
 * is what makes it a faithful rehearsal of the published site.
 */

type LoadState =
  | { status: "loading" }
  | { status: "error"; code: string }
  | { status: "ready"; project: BuilderProject };

export function PreviewRoute({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation(["builder", "errors", "public"]);
  const { projectId = "", "*": trailing = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const viewport = searchParams.get("viewport") === "desktop" ? "desktop" : "mobile";

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });

    projectsApi
      .load(workspaceId, projectId, { signal: controller.signal })
      .then((project) => setState({ status: "ready", project }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error", code: error instanceof ApiError ? error.code : "INTERNAL_ERROR" });
      });

    return () => controller.abort();
  }, [workspaceId, projectId]);

  const project = state.status === "ready" ? state.project : null;

  /** Internal links resolve to a path inside this preview, never to the editor. */
  const resolvePagePath = useCallback(
    (pageId: string): string | null => {
      const page = project?.pages.find((candidate) => candidate.id === pageId);
      if (!page) return null;
      const suffix = pagePath(page);
      return `/preview/${projectId}${suffix === "/" ? "" : suffix}`;
    },
    [project, projectId],
  );

  const rendererContext = useMemo<RendererContextValue>(
    () => ({
      resolvePagePath,
      resolveMediaUrl: (mediaId) => `/api/v1/workspaces/${workspaceId}/media/${mediaId}/content`,
      allowHttp: import.meta.env.DEV,
    }),
    [resolvePagePath, workspaceId],
  );

  if (state.status === "loading") {
    return (
      <p role="status" className="p-10 text-center text-ink-500">
        {t("builder:loading")}
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <div role="alert" className="p-10 text-center">
        <h1 className="font-display text-lg font-semibold text-ink-900">{t("builder:loadError")}</h1>
        <p className="mt-2 text-sm text-ink-600">
          {t(`errors:${state.code}` as "errors:INTERNAL_ERROR")}
        </p>
      </div>
    );
  }

  const page = findPageBySlug(state.project, trailing);

  if (page === null) {
    return (
      <div className="p-10 text-center">
        <PageMetadata title={t("public:notFound.title")} />
        <h1 className="font-display text-lg font-semibold text-ink-900">{t("public:notFound.title")}</h1>
        <p className="mt-2 text-sm text-ink-600">{t("public:notFound.description")}</p>
      </div>
    );
  }

  return (
    <RendererContext.Provider value={rendererContext}>
      <PageMetadata title={page.seo.title || `${page.name} — ${state.project.name}`} description={page.seo.description} />

      <div className="min-h-dvh bg-ink-100">
        <div className="flex justify-center gap-2 border-b border-ink-200 bg-white px-4 py-2">
          {(["desktop", "mobile"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={viewport === mode}
              onClick={() => setSearchParams(mode === "desktop" ? { viewport: "desktop" } : {}, { replace: true })}
              className={[
                "rounded-md px-3 py-1.5 text-xs font-medium",
                viewport === mode ? "bg-ink-900 text-white" : "border border-ink-200 text-ink-700",
              ].join(" ")}
            >
              {mode === "desktop" ? t("builder:topBar.previewDesktop") : t("builder:topBar.previewMobile")}
            </button>
          ))}
        </div>

        <div className="flex justify-center p-4">
          {/*
            Mobile preview uses the real available viewport; desktop preview is explicitly a scaled
            rendering of the configured desktop width, never a claim about mobile behaviour.
          */}
          <div
            style={viewport === "mobile" ? { width: "100%", maxWidth: MOBILE_PREVIEW_WIDTH } : { width: "100%" }}
            className="bg-white shadow-sm"
          >
            <ProjectPageRenderer page={page} breakpointId={viewport === "mobile" ? "mobile" : "desktop"} />
          </div>
        </div>
      </div>
    </RendererContext.Provider>
  );
}
