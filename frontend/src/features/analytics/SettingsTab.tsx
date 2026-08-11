import {
  ANALYTICS_COLLECTION_CATEGORIES,
  ANALYTICS_RETENTION_CHOICES,
  analyticsSettingsSchema,
  type AnalyticsCollectionCategory,
  type AnalyticsSettings,
} from "@websitebuilder/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError } from "@/api/client";
import { analyticsApi } from "@/api/analytics";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

/**
 * What this site collects, and the way to stop collecting it.
 *
 * Everything here is a promise to somebody else's visitors, so the destructive action is separated,
 * spelled out, and confirmed by typing — and the safe state is the one a site starts in.
 */
export function AnalyticsSettingsTab({
  workspaceId,
  projectId,
  settings,
  onSaved,
}: {
  workspaceId: string;
  projectId: string;
  settings: AnalyticsSettings;
  onSaved: (settings: AnalyticsSettings) => void;
}) {
  const { t } = useTranslation(["analytics", "errors", "common"]);
  const [draft, setDraft] = useState<AnalyticsSettings>(settings);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "deleted">("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const change = (patch: Partial<AnalyticsSettings>) => {
    setDraft({ ...draft, ...patch });
    setStatus("idle");
  };

  const toggleCategory = (category: AnalyticsCollectionCategory) => {
    change({
      categories: draft.categories.includes(category)
        ? draft.categories.filter((candidate) => candidate !== category)
        : [...draft.categories, category],
    });
  };

  const save = async () => {
    setError(null);
    setStatus("saving");
    try {
      // Validated here as well as on the server, so an impossible combination is caught before it
      // becomes a request rather than after.
      const parsed = analyticsSettingsSchema.parse(draft);
      const saved = await analyticsApi.saveSettings(workspaceId, projectId, parsed);
      onSaved(saved);
      setStatus("saved");
    } catch (caught) {
      setStatus("idle");
      setError(caught instanceof ApiError ? caught.code : "VALIDATION_ERROR");
    }
  };

  const remove = async () => {
    setError(null);
    try {
      await analyticsApi.deleteData(workspaceId, projectId);
      setConfirming(false);
      setStatus("deleted");
    } catch (caught) {
      setConfirming(false);
      setError(caught instanceof ApiError ? caught.code : "INTERNAL_ERROR");
    }
  };

  return (
    <section className="mt-6 max-w-prose">
      <h2 className="font-display text-lg font-semibold text-ink-950">{t("analytics:settings.title")}</h2>

      <div className="mt-4 space-y-5">
        <Toggle
          label={t("analytics:settings.enabled")}
          hint={t("analytics:settings.enabledHint")}
          checked={draft.enabled}
          onChange={(enabled) => change({ enabled })}
        />
        <Toggle
          label={t("analytics:settings.consentRequired")}
          hint={t("analytics:settings.consentHint")}
          checked={draft.consentRequired}
          onChange={(consentRequired) => change({ consentRequired })}
        />
        <Toggle
          label={t("analytics:settings.honorSignals")}
          hint={t("analytics:settings.honorSignalsHint")}
          checked={draft.honorPrivacySignals}
          onChange={(honorPrivacySignals) => change({ honorPrivacySignals })}
        />

        <label className="block text-sm font-medium text-ink-900">
          {t("analytics:settings.policy")}
          <input
            type="url"
            value={draft.privacyPolicyUrl}
            onChange={(event) => change({ privacyPolicyUrl: event.target.value })}
            className="mt-1 w-full rounded-md border border-ink-200 px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-xs font-normal text-ink-500">{t("analytics:settings.policyHint")}</span>
        </label>

        <label className="block text-sm font-medium text-ink-900">
          {t("analytics:settings.retention")}
          <select
            value={draft.retentionDays}
            onChange={(event) => change({ retentionDays: Number(event.target.value) as AnalyticsSettings["retentionDays"] })}
            className="mt-1 block rounded-md border border-ink-200 px-2 py-1.5 text-sm"
          >
            {ANALYTICS_RETENTION_CHOICES.map((days) => (
              <option key={days} value={days}>
                {t("analytics:settings.retentionDays", { count: days })}
              </option>
            ))}
          </select>
        </label>

        <fieldset>
          <legend className="text-sm font-medium text-ink-900">{t("analytics:settings.categories")}</legend>
          <div className="mt-2 space-y-2">
            {ANALYTICS_COLLECTION_CATEGORIES.map((category) => (
              <label key={category} className="flex items-center gap-2 text-sm text-ink-700">
                <input
                  type="checkbox"
                  checked={draft.categories.includes(category)}
                  onChange={() => toggleCategory(category)}
                />
                {t(`analytics:settings.category.${category}`)}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {error !== null && (
        <p role="alert" className="mt-4 text-sm text-red-800">
          {t(`errors:${error}` as "errors:INTERNAL_ERROR")}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={status === "saving"}
          className="rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700"
        >
          {t("analytics:settings.save")}
        </button>
        {status === "saved" && (
          <span role="status" className="text-sm text-ink-600">
            {t("analytics:settings.saved")}
          </span>
        )}
        {status === "deleted" && (
          <span role="status" className="text-sm text-ink-600">
            {t("analytics:settings.deleted")}
          </span>
        )}
      </div>

      <div className="mt-10 rounded-lg border border-red-200 bg-red-50 p-4">
        <h3 className="text-sm font-semibold text-red-900">{t("analytics:settings.danger")}</h3>
        <p className="mt-1 text-sm text-red-800">{t("analytics:settings.dangerHint")}</p>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-900"
        >
          {t("analytics:settings.confirmAction")}
        </button>
      </div>

      <ConfirmDialog
        open={confirming}
        title={t("analytics:settings.confirmTitle")}
        description={t("analytics:settings.dangerHint")}
        confirmLabel={t("analytics:settings.confirmAction")}
        destructive
        onConfirm={() => void remove()}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}

/**
 * A switch and its explanation.
 *
 * The hint is described rather than labelled: folding it into the label makes the control's
 * accessible name a paragraph, which is what a screen reader then announces on every focus.
 */
function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const describedBy = `hint-${label.replace(/\W+/g, "-").toLowerCase()}`;

  return (
    <div className="flex items-start gap-3">
      <input
        type="checkbox"
        id={`toggle-${describedBy}`}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-describedby={describedBy}
        className="mt-1"
      />
      <div>
        <label htmlFor={`toggle-${describedBy}`} className="block text-sm font-medium text-ink-900">
          {label}
        </label>
        <p id={describedBy} className="text-xs text-ink-500">
          {hint}
        </p>
      </div>
    </div>
  );
}
