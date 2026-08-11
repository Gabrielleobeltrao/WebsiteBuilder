import {
  AUDIT_CATEGORIES,
  formatRange,
  summariseReadiness,
  type AuditCategory,
  type CategoryResult,
  type Finding,
  type ResponsiveFinding,
  type Severity,
} from "@websitebuilder/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * The readiness summary on the site dashboard.
 *
 * "Not checked" is shown as prominently as a problem. A dashboard that reads clean because a check
 * never ran is worse than one that shows nothing, and every category here says which of the two it
 * is rather than collapsing both into a green tick.
 *
 * It also never claims the site is publishable. Publication runs its own preflight against one
 * exact revision, and two places asserting that would eventually disagree.
 */
export function ReadinessPanel({
  categories,
  currentRevision,
  onRerun,
  busy = false,
}: {
  categories: Partial<Record<AuditCategory, CategoryResult>>;
  currentRevision: number;
  onRerun?: () => void;
  busy?: boolean;
}) {
  const { t } = useTranslation("readiness");
  const [filter, setFilter] = useState<Severity | "all">("all");

  const summary = summariseReadiness({ categories, currentRevision });

  return (
    <section aria-labelledby="readiness-heading" className="rounded-xl border border-ink-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="readiness-heading" className="font-display text-lg font-semibold text-ink-950">
            {t("title")}
          </h2>
          <p className="mt-1 text-sm text-ink-600">{t("subtitle")}</p>
        </div>

        {onRerun !== undefined && (
          <button
            type="button"
            onClick={onRerun}
            disabled={busy}
            className="rounded-lg px-3 py-1.5 text-sm text-ink-800 ring-1 ring-ink-300 disabled:opacity-50"
          >
            {busy ? t("rerunning") : t("rerun")}
          </button>
        )}
      </div>

      <p role="status" className={`mt-3 text-sm ${summary.ready ? "text-accent-800" : "text-ink-800"}`}>
        {summary.ready ? t("ready") : t("notReady")}
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {(["all", "error", "warning", "manual-review"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={filter === option}
            onClick={() => setFilter(option)}
            className={[
              "rounded-md px-2.5 py-1 text-xs font-medium",
              filter === option ? "bg-ink-900 text-white" : "ring-1 ring-ink-300 text-ink-700",
            ].join(" ")}
          >
            {t(`filter.${option}` as "filter.all")}
          </button>
        ))}
      </div>

      <ul className="mt-4 space-y-3">
        {AUDIT_CATEGORIES.map((category) => (
          <li key={category}>
            <CategorySection
              category={category}
              result={summary.categories[category]}
              stale={summary.staleCategories.includes(category)}
              filter={filter}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function CategorySection({
  category,
  result,
  stale,
  filter,
}: {
  category: AuditCategory;
  result: CategoryResult;
  stale: boolean;
  filter: Severity | "all";
}) {
  const { t } = useTranslation("readiness");
  const name = t(`categories.${category}` as "categories.layout");

  if (result.status === "not-checked") {
    return (
      <div className="rounded-lg bg-ink-50 px-3 py-2">
        <p className="text-sm font-medium text-ink-900">
          {name}
          <span className="ml-2 rounded-full bg-ink-200 px-2 py-0.5 text-xs text-ink-800">
            {t("status.notChecked")}
          </span>
        </p>
        <p className="mt-0.5 text-xs text-ink-600">{t("notCheckedHint")}</p>
      </div>
    );
  }

  const visible = filter === "all" ? result.findings : result.findings.filter((finding) => finding.severity === filter);

  return (
    <div className="rounded-lg px-3 py-2 ring-1 ring-ink-200">
      <p className="text-sm font-medium text-ink-900">
        {name}
        {stale && (
          <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-900 ring-1 ring-amber-200">
            {t("status.stale")}
          </span>
        )}
      </p>

      {stale && <p className="mt-0.5 text-xs text-amber-900">{t("staleHint")}</p>}

      {result.findings.length === 0 ? (
        <p className="mt-1 text-xs text-accent-800">{t("status.clean")}</p>
      ) : visible.length === 0 ? (
        <p className="mt-1 text-xs text-ink-600">{t("empty")}</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {visible.map((finding, index) => (
            <li key={`${finding.code}-${finding.elementId ?? index}`} className="text-xs">
              <span
                className={[
                  "mr-2 rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset",
                  finding.severity === "error"
                    ? "bg-red-50 text-red-800 ring-red-200"
                    : finding.severity === "warning"
                      ? "bg-amber-50 text-amber-900 ring-amber-200"
                      : "bg-ink-50 text-ink-700 ring-ink-200",
                ].join(" ")}
              >
                {t(`severity.${finding.severity}` as "severity.error")}
              </span>
              <span className="text-ink-800">{finding.detail}</span>
              <WidthRanges finding={finding} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Layout findings carry the widths they apply at; other audits do not, and say nothing. */
function WidthRanges({ finding }: { finding: Finding }) {
  const { t } = useTranslation("readiness");
  const ranges = (finding as ResponsiveFinding).ranges;

  if (ranges === undefined || ranges.length === 0) return null;

  return <span className="ml-2 text-ink-500">{t("widths", { ranges: ranges.map(formatRange).join(", ") })}</span>;
}
