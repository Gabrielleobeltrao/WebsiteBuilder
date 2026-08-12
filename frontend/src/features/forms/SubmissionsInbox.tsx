import {
  SUBMISSION_STATUSES,
  type FormSubmissionRecord,
  type FormSummary,
  type SubmissionPage,
  type SubmissionStatus,
} from "@websitebuilder/shared";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";

import { ApiError } from "@/api/client";
import { formsApi, type SubmissionQuery } from "@/api/forms";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { useRelativeTime } from "@/hooks/useRelativeTime";

type LoadState = { status: "loading" } | { status: "error"; code: string } | { status: "ready"; page: SubmissionPage };

/**
 * The answers people actually sent.
 *
 * This is the record of truth for a form: notifications may or may not be delivered depending on a
 * provider nobody here controls, and this list is what the customer can always come back to.
 *
 * Filters live in the URL rather than in component state, so a link to "new answers to the contact
 * form" is a link somebody can send, bookmark, or reload without losing where they were.
 */
export function SubmissionsInbox({
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
  const [searchParams, setSearchParams] = useSearchParams();
  const formFilterId = useId();
  const statusFilterId = useId();
  const fromId = useId();
  const toId = useId();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [forms, setForms] = useState<FormSummary[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<FormSubmissionRecord | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const query = useMemo((): SubmissionQuery => {
    const status = searchParams.get("status");
    const page = Number(searchParams.get("page") ?? "1");

    return {
      ...(searchParams.get("formId") ? { formId: searchParams.get("formId")! } : {}),
      ...(status !== null && (SUBMISSION_STATUSES as readonly string[]).includes(status)
        ? { status: status as SubmissionStatus }
        : {}),
      ...(searchParams.get("from") ? { from: `${searchParams.get("from")!}T00:00:00.000Z` } : {}),
      ...(searchParams.get("to") ? { to: `${searchParams.get("to")!}T23:59:59.999Z` } : {}),
      ...(Number.isFinite(page) && page > 1 ? { page } : {}),
    };
  }, [searchParams]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: "loading" });
      try {
        const [page, definitions] = await Promise.all([
          formsApi.listSubmissions(workspaceId, projectId, { ...query, ...(signal ? { signal } : {}) }),
          formsApi.list(workspaceId, projectId, signal ? { signal } : {}),
        ]);
        setForms(definitions);
        setState({ status: "ready", page });
        setSelected(new Set());
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error", code: error instanceof ApiError ? error.code : "INTERNAL_ERROR" });
      }
    },
    [workspaceId, projectId, query],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const setFilter = (name: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === "") next.delete(name);
    else next.set(name, value);
    // Any filter change puts you back on the first page: staying on page 4 of a result set that now
    // has one page shows an empty screen that looks like "nothing found".
    next.delete("page");
    setSearchParams(next, { replace: true });
  };

  const apply = async (action: SubmissionStatus | "delete") => {
    if (selected.size === 0) return;
    setBusy(true);
    setFailure(null);
    try {
      await formsApi.bulk(workspaceId, projectId, [...selected], action);
      await load();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.code : "INTERNAL_ERROR");
    } finally {
      setBusy(false);
      setConfirmingDelete(false);
    }
  };

  const items = state.status === "ready" ? state.page.items : [];
  const nameById = new Map(forms.map((form) => [form.id, form.name]));
  const pages = state.status === "ready" ? Math.max(1, Math.ceil(state.page.total / state.page.perPage)) : 1;
  const currentPage = state.status === "ready" ? state.page.page : 1;
  const filtered = searchParams.toString() !== "";

  return (
    <div>
      <Link to={basePath} className="text-sm font-medium text-ink-600 underline underline-offset-4">
        {t("forms:actions.back")}
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-950">{t("forms:inbox.title")}</h1>

        {query.formId !== undefined && (
          <a
            href={formsApi.exportUrl(workspaceId, projectId, query.formId, query)}
            className="rounded-md border border-ink-200 px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
          >
            {t("forms:inbox.export")}
          </a>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-4">
        <label htmlFor={formFilterId} className="text-xs font-medium text-ink-600">
          {t("forms:overview.columns.name")}
          <select
            id={formFilterId}
            value={searchParams.get("formId") ?? ""}
            onChange={(event) => setFilter("formId", event.target.value)}
            className="mt-1 block rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
          >
            <option value="">{t("forms:inbox.allForms")}</option>
            {forms.map((form) => (
              <option key={form.id} value={form.id}>
                {form.name}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor={statusFilterId} className="text-xs font-medium text-ink-600">
          {t("forms:inbox.filterStatus")}
          <select
            id={statusFilterId}
            value={searchParams.get("status") ?? ""}
            onChange={(event) => setFilter("status", event.target.value)}
            className="mt-1 block rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
          >
            <option value="">{t("forms:inbox.allForms")}</option>
            {SUBMISSION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`forms:status.${status}` as "forms:status.new")}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor={fromId} className="text-xs font-medium text-ink-600">
          {t("forms:inbox.filterFrom")}
          <input
            id={fromId}
            type="date"
            value={searchParams.get("from") ?? ""}
            onChange={(event) => setFilter("from", event.target.value)}
            className="mt-1 block rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
          />
        </label>

        <label htmlFor={toId} className="text-xs font-medium text-ink-600">
          {t("forms:inbox.filterTo")}
          <input
            id={toId}
            type="date"
            value={searchParams.get("to") ?? ""}
            onChange={(event) => setFilter("to", event.target.value)}
            className="mt-1 block rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
          />
        </label>
      </div>

      {state.status === "ready" && (
        <dl className="mt-6 flex flex-wrap gap-6 text-sm">
          {SUBMISSION_STATUSES.map((status) => (
            <div key={status}>
              <dt className="text-xs text-ink-500">{t(`forms:status.${status}` as "forms:status.new")}</dt>
              <dd className="font-display text-lg font-semibold text-ink-900">{state.page.counts[status]}</dd>
            </div>
          ))}
        </dl>
      )}

      {failure !== null && (
        <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {t(`errors:${failure}` as "errors:INTERNAL_ERROR")}
        </p>
      )}

      {selected.size > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-ink-200 bg-ink-50 p-3">
          <p className="text-sm text-ink-800">{t("forms:inbox.selected", { count: selected.size })}</p>
          <button type="button" disabled={busy} onClick={() => void apply("read")} className="text-sm text-ink-700 underline">
            {t("forms:inbox.markRead")}
          </button>
          <button type="button" disabled={busy} onClick={() => void apply("new")} className="text-sm text-ink-700 underline">
            {t("forms:inbox.markUnread")}
          </button>
          <button type="button" disabled={busy} onClick={() => void apply("archived")} className="text-sm text-ink-700 underline">
            {t("forms:inbox.archive")}
          </button>
          <button type="button" disabled={busy} onClick={() => void apply("spam")} className="text-sm text-ink-700 underline">
            {t("forms:inbox.spam")}
          </button>
          {/* Deleting is the one action here nothing undoes, so it is the one that asks. */}
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmingDelete(true)}
            className="text-sm text-red-700 underline"
          >
            {t("forms:inbox.delete")}
          </button>
        </div>
      )}

      {state.status === "loading" && (
        <p role="status" className="mt-8 rounded-lg border border-ink-100 p-8 text-center text-ink-500">
          {t("common:state.loading")}
        </p>
      )}

      {state.status === "error" && (
        <div role="alert" className="mt-8 rounded-lg border border-red-200 bg-red-50 p-6">
          <p className="text-sm text-red-800">{t(`errors:${state.code}` as "errors:INTERNAL_ERROR")}</p>
        </div>
      )}

      {state.status === "ready" && items.length === 0 && (
        <p className="mt-8 rounded-lg border border-dashed border-ink-200 p-10 text-center text-sm text-ink-600">
          {filtered ? t("forms:inbox.emptyFiltered") : t("forms:inbox.empty")}
        </p>
      )}

      {items.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                <th scope="col" className="py-2 pr-3">
                  <input
                    type="checkbox"
                    aria-label={t("forms:inbox.selectAll")}
                    checked={selected.size === items.length}
                    onChange={(event) =>
                      setSelected(event.target.checked ? new Set(items.map((item) => item.id)) : new Set())
                    }
                  />
                </th>
                <th scope="col" className="py-2 pr-4 font-semibold">{t("forms:overview.columns.name")}</th>
                <th scope="col" className="py-2 pr-4 font-semibold">{t("forms:inbox.detail")}</th>
                <th scope="col" className="py-2 pr-4 font-semibold">{t("forms:inbox.filterStatus")}</th>
                <th scope="col" className="py-2 font-semibold">{t("forms:inbox.received")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((submission) => (
                <tr key={submission.id} className="border-b border-ink-100">
                  <td className="py-3 pr-3">
                    <input
                      type="checkbox"
                      aria-label={t("forms:inbox.select")}
                      checked={selected.has(submission.id)}
                      onChange={(event) => {
                        const next = new Set(selected);
                        if (event.target.checked) next.add(submission.id);
                        else next.delete(submission.id);
                        setSelected(next);
                      }}
                    />
                  </td>
                  <td className="py-3 pr-4 text-ink-700">{nameById.get(submission.formId) ?? submission.formId}</td>
                  <td className="py-3 pr-4">
                    <button
                      type="button"
                      onClick={() => setOpen(submission)}
                      className="text-left text-ink-900 underline underline-offset-4"
                    >
                      {summarize(submission)}
                    </button>
                  </td>
                  <td className="py-3 pr-4 text-ink-600">
                    {t(`forms:status.${submission.status}` as "forms:status.new")}
                  </td>
                  <td className="py-3 text-ink-600">{formatRelative(submission.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav aria-label={t("forms:inbox.title")} className="mt-4 flex items-center gap-3 text-sm">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => setFilter("page", String(currentPage - 1))}
            className="rounded-md border border-ink-200 px-3 py-1.5 disabled:opacity-40"
          >
            {t("forms:inbox.previous")}
          </button>
          <p className="text-ink-600">{t("forms:inbox.page", { page: currentPage, pages })}</p>
          <button
            type="button"
            disabled={currentPage >= pages}
            onClick={() => setFilter("page", String(currentPage + 1))}
            className="rounded-md border border-ink-200 px-3 py-1.5 disabled:opacity-40"
          >
            {t("forms:inbox.next")}
          </button>
        </nav>
      )}

      {open !== null && <SubmissionDetail submission={open} onClose={() => setOpen(null)} />}

      <ConfirmDialog
        open={confirmingDelete}
        destructive
        title={t("forms:inbox.deleteTitle")}
        description={t("forms:inbox.deleteWarning")}
        confirmLabel={t("forms:inbox.confirmDelete")}
        busy={busy}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => void apply("delete")}
      />
    </div>
  );
}

/** The first readable answer, so a row says something without being opened. */
function summarize(submission: FormSubmissionRecord): string {
  for (const value of Object.values(submission.values)) {
    if (typeof value === "string" && value.trim() !== "") return value.slice(0, 80);
  }
  return "—";
}

/**
 * One answer, with the questions as they were asked.
 *
 * The labels come from the snapshot the submission carries rather than from the definition as it is
 * now: a renamed question must not silently relabel an answer somebody already gave to a different
 * one.
 */
function SubmissionDetail({ submission, onClose }: { submission: FormSubmissionRecord; onClose: () => void }) {
  const { t } = useTranslation("forms");
  const asked = new Map(submission.fields.map((field) => [field.id, field.label]));

  return (
    <ConfirmDialog open title={t("inbox.detail")} confirmLabel={t("inbox.close")} onConfirm={onClose} onCancel={onClose}>
      <dl className="space-y-3 text-sm">
        {Object.entries(submission.values).map(([fieldId, value]) => (
          <div key={fieldId}>
            <dt className="text-xs text-ink-500">
              {asked.get(fieldId) ?? fieldId}
              {!asked.has(fieldId) && <span className="ml-2 text-ink-400">{t("inbox.retired")}</span>}
            </dt>
            <dd className="text-ink-900">{format(value)}</dd>
          </div>
        ))}

        {submission.source?.path !== undefined && (
          <div>
            <dt className="text-xs text-ink-500">{t("inbox.from")}</dt>
            <dd className="text-ink-900">{submission.source.path}</dd>
          </div>
        )}
      </dl>
    </ConfirmDialog>
  );
}

function format(value: unknown): string {
  if (value === true) return "✓";
  if (value === false) return "—";
  if (Array.isArray(value)) return value.join(", ");
  return String(value ?? "");
}
