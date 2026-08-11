import { useTranslation } from "react-i18next";

import type { ResourceState } from "./useAnalyticsResource";

/** Loading and failure, shown the same way wherever an analytics panel needs them. */
export function AnalyticsState({ state }: { state: ResourceState<unknown> }) {
  const { t } = useTranslation(["analytics", "errors"]);

  if (state.status === "loading") {
    return (
      <p role="status" className="mt-8 rounded-lg border border-ink-100 p-8 text-center text-ink-500">
        {t("analytics:loading")}
      </p>
    );
  }

  return (
    <div role="alert" className="mt-8 rounded-lg border border-red-200 bg-red-50 p-6">
      <h2 className="font-medium text-red-900">{t("analytics:error.title")}</h2>
      {/* Filters are preserved: a failure must not also lose the question that was being asked. */}
      <p className="mt-1 text-sm text-red-800">
        {t(`errors:${state.status === "error" ? state.code : "INTERNAL_ERROR"}` as "errors:INTERNAL_ERROR")}
      </p>
    </div>
  );
}

export function MetricGrid({ children }: { children: React.ReactNode }) {
  return <dl className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">{children}</dl>;
}

export function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-ink-100 p-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink-950">{value}</dd>
      {hint !== undefined && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}
