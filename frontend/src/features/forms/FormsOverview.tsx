import { hasChangesWaitingToPublish, type FormSummary, type FormUsage } from "@websitebuilder/shared";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { ApiError } from "@/api/client";
import { formsApi } from "@/api/forms";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { normalizeTerm } from "@/features/editor/panel/catalog";
import { useRelativeTime } from "@/hooks/useRelativeTime";

type LoadState =
  | { status: "loading" }
  | { status: "error"; code: string }
  | { status: "ready"; forms: FormSummary[] };

/**
 * Every form this site has, and what has happened to each one.
 *
 * A list rather than a canvas: a form is edited once and shown by however many pages reference it,
 * so the question this screen answers is "which forms exist, where are they, and has anybody
 * replied" — none of which a page layout can show.
 *
 * Every number on a row is a destination. A usage count that cannot be clicked leaves somebody
 * hunting through pages for a block, and an answer count that cannot be clicked leaves them
 * filtering the inbox by hand.
 */
export function FormsOverview({
  workspaceId,
  projectId,
  basePath,
}: {
  workspaceId: string;
  projectId: string;
  basePath: string;
}) {
  const { t } = useTranslation(["forms", "errors", "common"]);
  const formatRelative = useRelativeTime();
  const searchId = useId();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [search, setSearch] = useState("");
  const [pendingDelete, setPendingDelete] = useState<FormSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: "loading" });
      try {
        setState({ status: "ready", forms: await formsApi.list(workspaceId, projectId, signal ? { signal } : {}) });
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

  // Filtered here rather than by the server: the list is one request and a site's forms are counted
  // in tens, so a round trip per keystroke would be slower than the filter it replaced.
  const visible = useMemo(() => {
    if (state.status !== "ready") return [];
    const term = normalizeTerm(search);
    if (term === "") return state.forms;
    return state.forms.filter((form) => normalizeTerm(form.name).includes(term));
  }, [state, search]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setFailure(null);
    try {
      await action();
      await load();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.code : "INTERNAL_ERROR");
    } finally {
      setBusy(false);
      setPendingDelete(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-950">{t("forms:title")}</h1>
          <p className="mt-1 text-sm text-ink-600">{t("forms:subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to={`${basePath}/submissions`}
            className="rounded-md border border-ink-200 px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
          >
            {t("forms:overview.inbox")}
          </Link>
          <Link
            to={`${basePath}/new`}
            className="rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700"
          >
            {t("forms:overview.newForm")}
          </Link>
        </div>
      </div>

      {failure !== null && (
        <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {t(`errors:${failure}` as "errors:INTERNAL_ERROR")}
        </p>
      )}

      {state.status === "loading" && (
        <p role="status" className="mt-8 rounded-lg border border-ink-100 p-8 text-center text-ink-500">
          {t("common:state.loading")}
        </p>
      )}

      {state.status === "error" && (
        <div role="alert" className="mt-8 rounded-lg border border-red-200 bg-red-50 p-6">
          <p className="text-sm text-red-800">{t(`errors:${state.code}` as "errors:INTERNAL_ERROR")}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-4 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-900"
          >
            {t("common:actions.retry")}
          </button>
        </div>
      )}

      {state.status === "ready" && state.forms.length === 0 && (
        <div className="mt-8 rounded-lg border border-dashed border-ink-200 p-10 text-center">
          <p className="text-sm text-ink-600">{t("forms:overview.empty")}</p>
          <Link
            to={`${basePath}/new`}
            className="mt-4 inline-block rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white"
          >
            {t("forms:overview.emptyAction")}
          </Link>
        </div>
      )}

      {state.status === "ready" && state.forms.length > 0 && (
        <>
          <div className="mt-6">
            <label htmlFor={searchId} className="text-xs font-medium text-ink-600">
              {t("forms:overview.search")}
            </label>
            <input
              id={searchId}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="mt-1 w-full max-w-sm rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
            />
          </div>

          {/* The table scrolls inside its own box: a wide row must never push the page sideways on
              a phone, which is where somebody checks whether an answer arrived. */}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[46rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th scope="col" className="py-2 pr-4 font-semibold">{t("forms:overview.columns.name")}</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">{t("forms:overview.columns.state")}</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">{t("forms:overview.columns.usage")}</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">{t("forms:overview.columns.submissions")}</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">{t("forms:overview.columns.lastActivity")}</th>
                  <th scope="col" className="py-2 font-semibold">{t("forms:overview.columns.edited")}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((form) => (
                  <tr key={form.id} className="border-b border-ink-100 align-top">
                    <td className="py-3 pr-4">
                      <Link to={`${basePath}/${form.id}/edit`} className="font-medium text-ink-900 underline underline-offset-4">
                        {form.name}
                      </Link>
                      <div className="mt-1 flex flex-wrap gap-2">
                        <Link to={`${basePath}/${form.id}/edit`} className="text-xs text-ink-600 underline">
                          {t("forms:actions.edit")}
                        </Link>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void run(() => formsApi.duplicate(workspaceId, projectId, form.id, `${form.name} (2)`))
                          }
                          className="text-xs text-ink-600 underline"
                        >
                          {t("forms:actions.duplicate")}
                        </button>
                        {form.archived ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void run(() => formsApi.restore(workspaceId, projectId, form.id))}
                            className="text-xs text-ink-600 underline"
                          >
                            {t("forms:actions.restore")}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setPendingDelete(form)}
                            className="text-xs text-red-700 underline"
                          >
                            {t("forms:actions.delete")}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <StateBadge form={form} />
                      {/* Editing a form changes the builder now and changes the live site only at
                          the next publish. Saying which of your edits are live is the one question
                          somebody editing a form that is already collecting answers actually has. */}
                      {hasChangesWaitingToPublish(form) && (
                        <p className="mt-1 text-[11px] text-amber-700">{t("forms:overview.waitingToPublish")}</p>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <Usages usages={form.usages} basePath={basePath} />
                    </td>
                    <td className="py-3 pr-4">
                      <Link
                        to={`${basePath}/submissions?formId=${encodeURIComponent(form.id)}`}
                        className="text-ink-900 underline underline-offset-4"
                      >
                        {form.submissionCount}
                      </Link>
                      {form.unreadCount > 0 && (
                        <Link
                          to={`${basePath}/submissions?formId=${encodeURIComponent(form.id)}&status=new`}
                          className="ml-2 rounded-full bg-accent-50 px-2 py-0.5 text-xs text-accent-800 ring-1 ring-inset ring-accent-200"
                        >
                          {t("forms:overview.unread", { count: form.unreadCount })}
                        </Link>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-ink-600">
                      {form.lastSubmissionAt === null ? t("forms:overview.never") : formatRelative(form.lastSubmissionAt)}
                    </td>
                    <td className="py-3 text-ink-600">{formatRelative(form.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        destructive
        title={pendingDelete === null ? "" : `${t("forms:actions.delete")} — ${pendingDelete.name}`}
        description={t("forms:inbox.deleteWarning")}
        confirmLabel={t("forms:actions.delete")}
        busy={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const form = pendingDelete;
          if (form === null) return;
          void run(() => formsApi.remove(workspaceId, projectId, form.id));
        }}
      />
    </div>
  );
}

function StateBadge({ form }: { form: FormSummary }) {
  const { t } = useTranslation("forms");
  const key = form.archived ? "archived" : form.status === "ready" ? "ready" : form.status === "draft" ? "draft" : "needs_setup";
  const tone =
    key === "ready"
      ? "bg-accent-50 text-accent-800 ring-accent-200"
      : key === "archived"
        ? "bg-ink-50 text-ink-600 ring-ink-200"
        : "bg-red-50 text-red-800 ring-red-200";

  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${tone}`}>
      {t(`state.${key}` as "state.ready")}
    </span>
  );
}

/**
 * Where a form is shown, as links into the builder.
 *
 * A count on its own is the answer to a question nobody asked. What somebody wants after seeing
 * "3 pages" is to open one of them on the block itself, which is what these do.
 */
function Usages({ usages, basePath }: { usages: FormUsage[]; basePath: string }) {
  const { t } = useTranslation("forms");
  if (usages.length === 0) return <span className="text-ink-500">{t("overview.usage.none")}</span>;

  const builder = basePath.replace(/\/forms$/, "/builder");

  return (
    <ul className="space-y-1">
      {usages.slice(0, 3).map((usage) => (
        <li key={usage.elementId}>
          <Link
            to={`${builder}/${usage.pageId}?element=${encodeURIComponent(usage.elementId)}`}
            className="text-ink-700 underline underline-offset-4"
          >
            {usage.shared ? t("overview.usage.shared", { page: usage.pageName }) : usage.pageName}
          </Link>
        </li>
      ))}
      {usages.length > 3 && (
        <li className="text-xs text-ink-500">{t("overview.usage.count", { count: usages.length })}</li>
      )}
    </ul>
  );
}
