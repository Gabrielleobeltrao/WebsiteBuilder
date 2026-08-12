import type { FormSummary } from "@websitebuilder/shared";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { formsApi } from "@/api/forms";
import { selectEditingDevice, useEditorStore } from "@/features/editor/store/editorStore";
import { safeReturnPath } from "@/lib/return-path";

/**
 * Which form this block shows.
 *
 * The control it replaces was a text box holding an identifier. That is a database key asked of a
 * designer: to fill it in you had to open another screen, find the form, copy 24 hexadecimal
 * characters, come back, and get them right — and nothing told you when you had not.
 *
 * Everything here is about removing that: pick from a list, or make a form and be bound to it in
 * the same click. Leaving the block bound to nothing stays possible, because a block has to be
 * insertable before it can be filled in, and readiness is what asks for the rest.
 */
export function FormBindingField({
  workspaceId,
  projectId,
  elementId,
  formId,
  forms,
  loading,
  onBind,
  onFormsChanged,
}: {
  workspaceId: string;
  projectId: string;
  elementId: string;
  formId: string;
  forms: readonly FormSummary[];
  loading: boolean;
  onBind: (formId: string) => void;
  onFormsChanged: () => void;
}) {
  const { t } = useTranslation(["builder", "forms", "errors"]);
  const navigate = useNavigate();
  const selectId = useId();
  const nameId = useId();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const bound = forms.find((form) => form.id === formId) ?? null;
  const formsBase = `/app/${workspaceId}/sites/${projectId}/forms`;

  /**
   * Leaves for the Forms Center and comes back to this block.
   *
   * The draft is saved first, because the builder is being unmounted: an autosave that had not yet
   * fired would take the placement with it. The return address is a path this application built and
   * then re-validated, never a value read back from anywhere a stranger could set.
   */
  const leaveFor = async (destination: string) => {
    await useEditorStore.getState().save();

    const store = useEditorStore.getState();
    const pageId = store.ui.currentPageId ?? "";
    // The same three parameters the builder already restores from an address: page, device and
    // selection. Reusing them means returning is the route's existing behaviour rather than a
    // second mechanism that has to be kept in step with it.
    const device = selectEditingDevice(store);
    const returnTo = safeReturnPath(
      `/app/${workspaceId}/sites/${projectId}/builder/${pageId}?element=${encodeURIComponent(elementId)}&device=${device}`,
    );

    navigate(`${destination}?returnTo=${encodeURIComponent(returnTo)}`);
  };

  const create = async () => {
    const trimmed = name.trim();
    if (trimmed === "") return;

    setBusy(true);
    setFailure(null);
    try {
      // Created and bound in one step. A form that exists but is attached to nothing is the state
      // this control exists to avoid.
      const created = await formsApi.create(workspaceId, projectId, {
        name: trimmed,
        fields: [],
        submitLabel: t("forms:templates.blank.submit"),
        successBehavior: { type: "message", message: t("forms:templates.blank.success") },
        notificationRecipients: [],
      });

      onBind(created.id);
      onFormsChanged();
      setCreating(false);
      setName("");
    } catch (error) {
      setFailure(error instanceof Error ? "INTERNAL_ERROR" : "INTERNAL_ERROR");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <label htmlFor={selectId} className="block text-xs font-medium text-ink-700">
        {t("builder:fields.formId")}
        <select
          id={selectId}
          value={formId}
          disabled={loading}
          onChange={(event) => onBind(event.target.value)}
          className="mt-1 w-full rounded-md border border-ink-200 px-2 py-1.5 text-sm text-ink-900"
        >
          <option value="">{t("builder:form.noneChosen")}</option>
          {forms.map((form) => (
            <option key={form.id} value={form.id}>
              {form.name}
            </option>
          ))}
        </select>
      </label>

      {/* A block pointing at something that is gone or closed says so here, beside the control that
          fixes it, rather than only in a readiness list on another screen. */}
      {formId !== "" && bound === null && !loading && (
        <p role="alert" className="text-[11px] text-red-700">
          {t("builder:form.missing")}
        </p>
      )}
      {bound?.archived === true && (
        <p role="alert" className="text-[11px] text-red-700">
          {t("builder:form.archived")}
        </p>
      )}
      {bound !== null && !bound.archived && bound.status !== "ready" && (
        <p role="status" className="text-[11px] text-amber-700">
          {t("builder:form.incomplete")}
        </p>
      )}

      {bound !== null && (
        <p className="text-[11px] text-ink-500">
          {t("builder:form.usedOn", { count: bound.usages.length })}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        {creating ? null : (
          <button type="button" onClick={() => setCreating(true)} className="text-[11px] text-ink-700 underline">
            {t("builder:form.create")}
          </button>
        )}
        {bound !== null && (
          <button
            type="button"
            onClick={() => void leaveFor(`${formsBase}/${bound.id}/edit`)}
            className="text-[11px] text-ink-700 underline"
          >
            {t("builder:form.editFields")}
          </button>
        )}
        <button type="button" onClick={() => void leaveFor(formsBase)} className="text-[11px] text-ink-700 underline">
          {t("builder:form.openCenter")}
        </button>
      </div>

      {creating && (
        <div className="rounded-md border border-ink-200 p-2">
          <label htmlFor={nameId} className="block text-xs font-medium text-ink-700">
            {t("forms:editor.name")}
            <input
              id={nameId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 w-full rounded-md border border-ink-200 px-2 py-1.5 text-sm text-ink-900"
            />
          </label>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy || name.trim() === ""}
              onClick={() => void create()}
              className="rounded-md bg-accent-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
            >
              {t("forms:actions.save")}
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-md border border-ink-200 px-2 py-1 text-xs text-ink-700"
            >
              {t("forms:actions.cancel")}
            </button>
          </div>
          {failure !== null && (
            <p role="alert" className="mt-2 text-[11px] text-red-700">
              {t(`errors:${failure}` as "errors:INTERNAL_ERROR")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
