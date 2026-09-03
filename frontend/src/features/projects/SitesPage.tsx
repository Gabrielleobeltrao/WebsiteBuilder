import type { ProjectSummary } from "@websitebuilder/shared";
import { useCallback, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { ApiError } from "@/api/client";
import { projectsApi } from "@/api/projects";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { PageMetadata } from "@/components/common/PageMetadata";
import { useRelativeTime } from "@/hooks/useRelativeTime";

/** Renaming and deleting live on the site's own settings; this list only creates. */
type DialogState = { kind: "none" } | { kind: "create" };

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
                <SiteCard key={project.id} workspaceId={workspaceId} project={project} />
              ))}
            </ul>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={dialog.kind === "create"}
        title={t("dashboard:sites.createTitle")}
        confirmLabel={t("dashboard:sites.confirmCreate")}
        busy={busy}
        onCancel={closeDialog}
        onConfirm={() => {
          const trimmed = name.trim();
          if (trimmed.length === 0) return;
          void runAction(() => projectsApi.create(workspaceId, { name: trimmed }));
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

    </div>
  );
}


/**
 * One site, collapsed to what a person scanning the list needs.
 *
 * It used to carry four buttons and a run-on line of metadata, on every row: publishing, visiting,
 * the dashboard, the builder. A list of ten sites was forty controls, and on a phone they wrapped
 * into a block taller than the card. So the card states the name, one honest word about where the
 * site is, and the one destination everything else lives behind — and the detail is a disclosure
 * for the reader who wants it, already answered by the same request that returned the row.
 */
function SiteCard({ workspaceId, project }: { workspaceId: string; project: ProjectSummary }) {
  const { t } = useTranslation(["dashboard", "publishing", "errors", "common"]);
  const formatRelative = useRelativeTime();
  const [open, setOpen] = useState(false);
  const detailsId = useId();

  const summary = project.summary;
  const blockers = summary?.knownBlockers ?? [];

  /** One phrase, chosen by the most important true thing about the site. */
  const statusKey =
    blockers.length > 0
      ? "attention"
      : !project.isPublished
        ? "draft"
        : summary?.hasPendingChanges === true
          ? "pending"
          : "live";

  return (
    <li className="rounded-lg border border-ink-200 bg-white px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {/* The name is the way in. Underlined always, not on hover: a touch device has no hover,
              so a link that only reveals itself to a pointer is invisible to everyone on a phone —
              which is where this list is most used, because the editor needs a wide screen. */}
          <h2 className="truncate font-medium text-ink-900">
            <Link
              to={`/app/${workspaceId}/sites/${project.id}/dashboard`}
              className="underline decoration-ink-300 underline-offset-4 hover:decoration-ink-900"
            >
              {project.name}
            </Link>
          </h2>
          <p className={`mt-1 text-xs ${statusKey === "attention" ? "text-amber-700" : "text-ink-500"}`}>
            {t(`dashboard:sites.card.status.${statusKey}` as "dashboard:sites.card.status.live")}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {/*
            The disclosure, and one destination.

            A real button with `aria-expanded` and `aria-controls`, not a hover card or a chevron
            that does nothing without a pointer: the detail has to be reachable by keyboard and
            announceable, or it is detail only some people have.
          */}
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            aria-controls={detailsId}
            aria-label={t("dashboard:sites.card.detailsFor", { name: project.name })}
            className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50"
          >
            {t("dashboard:sites.card.details")}
          </button>
          <Link
            to={`/app/${workspaceId}/sites/${project.id}/dashboard`}
            className="rounded-md bg-accent-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-700"
          >
            {t("dashboard:sites.panel")}
          </Link>
        </div>
      </div>

      {/* Rendered only when open, and always in the same place, so opening one card does not move
          the cards below it more than the panel it just added. */}
      <div id={detailsId} hidden={!open} className="mt-4 border-t border-ink-100 pt-3 text-xs text-ink-600">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <div>
            <dt className="font-medium text-ink-700">{t("dashboard:sites.card.lastUpdate")}</dt>
            <dd>{formatRelative(project.updatedAt)}</dd>
          </div>

          <div>
            <dt className="font-medium text-ink-700">{t("dashboard:sites.card.pages")}</dt>
            <dd>{t("dashboard:sites.pageCount", { count: project.pageCount })}</dd>
          </div>

          <div>
            <dt className="font-medium text-ink-700">{t("dashboard:sites.card.pendingChanges")}</dt>
            <dd>
              {t(
                summary?.hasPendingChanges === true
                  ? "dashboard:sites.card.pendingYes"
                  : "dashboard:sites.card.pendingNo",
              )}
            </dd>
          </div>

          <div>
            <dt className="font-medium text-ink-700">{t("dashboard:sites.card.blockers")}</dt>
            <dd>
              {blockers.length === 0 ? (
                t("dashboard:sites.card.blockersNone")
              ) : (
                <ul className="list-disc pl-4">
                  {blockers.map((code) => (
                    <li key={code}>{t(`dashboard:sites.card.blocker.${code}` as "dashboard:sites.card.blocker.no-address")}</li>
                  ))}
                </ul>
              )}
              {/* Said out loud, because a list cannot run the full audit for every site and a card
                  that implied it had would be lying about what it checked. */}
              <p className="mt-1 text-ink-400">{t("dashboard:sites.card.blockersNote")}</p>
            </dd>
          </div>

          <div>
            <dt className="font-medium text-ink-700">
              {t("dashboard:sites.card.traffic", {
                days: summary?.traffic.state === "measured" ? summary.traffic.days : 30,
              })}
            </dt>
            <dd>
              {summary?.traffic.state === "measured" ? (
                <>
                  <span>{t("dashboard:sites.card.views", { count: summary.traffic.views })}</span>
                  {" · "}
                  {/* Null is not zero: server counting is unconditional, visitors come from the
                      browser and only where the owner turned measurement on. */}
                  <span>
                    {summary.traffic.visitors === null
                      ? t("dashboard:sites.card.visitorsUnavailable")
                      : t("dashboard:sites.card.visitors", { count: summary.traffic.visitors })}
                  </span>
                </>
              ) : (
                t("dashboard:sites.card.trafficUnavailable")
              )}
            </dd>
          </div>
        </dl>

        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            to={`/app/${workspaceId}/sites/${project.id}/builder`}
            className="rounded-md border border-ink-200 px-3 py-1.5 text-ink-700 hover:bg-ink-50"
          >
            {t("dashboard:sites.card.edit")}
          </Link>
          {/* The published address, when there is one. Not a preview: what somebody opening this
              list wants is the page their visitors are actually on. */}
          {project.liveUrl !== undefined && (
            <a
              href={project.liveUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-md border border-ink-200 px-3 py-1.5 text-ink-700 hover:bg-ink-50"
            >
              {t("dashboard:sites.visit")}
            </a>
          )}
          <Link
            to={`/app/${workspaceId}/sites/${project.id}/publish`}
            className="rounded-md border border-ink-200 px-3 py-1.5 text-ink-700 hover:bg-ink-50"
          >
            {t("publishing:publish.title")}
          </Link>
        </div>
      </div>
    </li>
  );
}
