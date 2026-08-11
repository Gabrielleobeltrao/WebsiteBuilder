import type { ProjectSummary } from "@websitebuilder/shared";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { ApiError } from "@/api/client";
import { projectsApi } from "@/api/projects";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { PageMetadata } from "@/components/common/PageMetadata";
import { useRelativeTime } from "@/hooks/useRelativeTime";

type DialogState =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "rename"; project: ProjectSummary }
  | { kind: "delete"; project: ProjectSummary };

type LoadState =
  | { status: "loading" }
  | { status: "error"; code: string }
  | { status: "ready"; projects: ProjectSummary[] };

/**
 * Preliminary workspace-scoped site list. The agency and client dashboards in Phase 13 reuse these
 * pieces; what is deliberately not here is any client-side ownership assumption — the workspace in
 * the URL is only a request, and the server decides what the caller may see.
 */
export function SitesPage({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation(["dashboard", "publishing", "errors", "common"]);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const formatRelative = useRelativeTime();

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: "loading" });
      try {
        const projects = await projectsApi.list(workspaceId, signal ? { signal } : {});
        setState({ status: "ready", projects });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error", code: error instanceof ApiError ? error.code : "INTERNAL_ERROR" });
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    // Cancelling on workspace change is what stops a slow response from a previous tenant landing
    // in the new tenant's list.
    return () => controller.abort();
  }, [load]);

  const closeDialog = () => {
    setDialog({ kind: "none" });
    setName("");
  };

  const runAction = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      closeDialog();
      await load();
    } catch (error) {
      setState({ status: "error", code: error instanceof ApiError ? error.code : "INTERNAL_ERROR" });
      closeDialog();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-6 py-10 sm:px-10">
      <PageMetadata title={`${t("dashboard:sites.title")} — ${t("common:productName")}`} />

      <div className="mx-auto max-w-4xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-950">
              {t("dashboard:sites.title")}
            </h1>
            <p className="mt-1 text-sm text-ink-600">{t("dashboard:sites.description")}</p>
          </div>
          <button
            type="button"
            onClick={() => setDialog({ kind: "create" })}
            className="rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700"
          >
            {t("dashboard:sites.create")}
          </button>
        </div>

        <div className="mt-8">
          {state.status === "loading" && (
            <p role="status" className="rounded-lg border border-ink-100 p-8 text-center text-ink-500">
              {t("dashboard:sites.loading")}
            </p>
          )}

          {state.status === "error" && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-6">
              <h2 className="font-medium text-red-900">{t("dashboard:sites.error.title")}</h2>
              <p className="mt-1 text-sm text-red-800">
                {t(`errors:${state.code}` as "errors:INTERNAL_ERROR")}
              </p>
              <button
                type="button"
                onClick={() => void load()}
                className="mt-4 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-900"
              >
                {t("dashboard:sites.error.retry")}
              </button>
            </div>
          )}

          {state.status === "ready" && state.projects.length === 0 && (
            <div className="rounded-lg border border-dashed border-ink-200 p-10 text-center">
              <h2 className="font-medium text-ink-900">{t("dashboard:sites.empty.title")}</h2>
              <p className="mt-1 text-sm text-ink-600">{t("dashboard:sites.empty.description")}</p>
            </div>
          )}

          {state.status === "ready" && state.projects.length > 0 && (
            <ul className="space-y-3">
              {state.projects.map((project) => (
                <li
                  key={project.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-ink-200
                    bg-white px-5 py-4"
                >
                  <div className="min-w-0">
                    {/* The name is the way in. Underlined always, not on hover: a touch device has
                        no hover, so a link that only reveals itself to a pointer is invisible to
                        everyone on a phone — which is where this list is most used, because the
                        editor needs a pointer and a wide screen. */}
                    <h2 className="truncate font-medium text-ink-900">
                      <Link
                        to={`/app/${workspaceId}/sites/${project.id}/dashboard`}
                        className="underline decoration-ink-300 underline-offset-4 hover:decoration-ink-900"
                      >
                        {project.name}
                      </Link>
                    </h2>
                    <p className="mt-1 text-xs text-ink-500">
                      {t("dashboard:sites.pageCount", { count: project.pageCount })} ·{" "}
                      {t("dashboard:sites.updatedAt", { when: formatRelative(project.updatedAt) })} ·{" "}
                      {project.liveUrl === undefined
                        ? t("dashboard:sites.notPublished")
                        : project.liveUrl.replace(/^https?:\/\//, "")}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {/* Publishing is what puts a change in front of visitors, and it is needed
                        again every time the site is edited — so it belongs on the card rather than
                        two taps away behind the site's own page. */}
                    <Link
                      to={`/app/${workspaceId}/sites/${project.id}/publish`}
                      className={
                        project.liveUrl === undefined
                          ? "rounded-md bg-accent-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-700"
                          : "rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50"
                      }
                    >
                      {t("publishing:publish.title")}
                    </Link>
                    {/* The published address, when there is one. Not a preview: a preview is a
                        rehearsal of what a visitor would get, and what someone opening this list
                        wants is the page their visitors are actually on. It appears only where the
                        site is genuinely serving — a button to a page that does not exist yet is
                        worse than no button. */}
                    {project.liveUrl !== undefined && (
                      <a
                        href={project.liveUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50"
                      >
                        {t("dashboard:sites.visit")}
                      </a>
                    )}
                    <Link
                      to={`/app/${workspaceId}/sites/${project.id}/builder`}
                      className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50"
                    >
                      {t("dashboard:sites.open")}
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        setName(project.name);
                        setDialog({ kind: "rename", project });
                      }}
                      className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50"
                    >
                      {t("dashboard:sites.rename")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDialog({ kind: "delete", project })}
                      className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50"
                    >
                      {t("dashboard:sites.delete")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={dialog.kind === "create" || dialog.kind === "rename"}
        title={dialog.kind === "rename" ? t("dashboard:sites.renameTitle") : t("dashboard:sites.createTitle")}
        confirmLabel={
          dialog.kind === "rename" ? t("dashboard:sites.confirmRename") : t("dashboard:sites.confirmCreate")
        }
        busy={busy}
        onCancel={closeDialog}
        onConfirm={() => {
          const trimmed = name.trim();
          if (trimmed.length === 0) return;
          void runAction(() =>
            dialog.kind === "rename"
              ? projectsApi.rename(workspaceId, dialog.project.id, trimmed)
              : projectsApi.create(workspaceId, { name: trimmed }),
          );
        }}
      >
        <label className="block text-sm font-medium text-ink-700">
          {t("dashboard:sites.nameLabel")}
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("dashboard:sites.namePlaceholder")}
            className="mt-1 w-full rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
          />
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog.kind === "delete"}
        destructive
        title={t("dashboard:sites.deleteTitle")}
        description={t("dashboard:sites.deleteWarning")}
        confirmLabel={t("dashboard:sites.confirmDelete")}
        busy={busy}
        onCancel={closeDialog}
        onConfirm={() => {
          if (dialog.kind !== "delete") return;
          void runAction(() => projectsApi.remove(workspaceId, dialog.project.id));
        }}
      />
    </div>
  );
}
