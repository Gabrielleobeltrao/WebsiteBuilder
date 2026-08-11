import { formatRange, type ResponsiveFinding } from "@websitebuilder/shared";
import { useTranslation } from "react-i18next";

/**
 * Responsive diagnostics for the page being previewed.
 *
 * Findings are shown, never applied. A tool that silently repositions an element to clear an
 * overflow leaves a designer unable to tell what they built from what it decided, and the next edit
 * fights it. Each entry names the element and the widths it applies at.
 */
export function DiagnosticsPanel({
  findings,
  onSelect,
}: {
  findings: ResponsiveFinding[];
  onSelect?: (elementId: string) => void;
}) {
  const { t } = useTranslation("builder");

  const errors = findings.filter((finding) => finding.severity === "error");
  const warnings = findings.filter((finding) => finding.severity !== "error");

  if (findings.length === 0) {
    return (
      <p role="status" className="px-4 py-3 text-xs text-ink-600">
        {t("preview.diagnostics.clear")}
      </p>
    );
  }

  return (
    <section aria-labelledby="diagnostics-heading" className="border-t border-ink-200 bg-white px-4 py-3">
      <h2 id="diagnostics-heading" className="text-xs font-semibold uppercase tracking-wide text-ink-500">
        {t("preview.diagnostics.title", { count: findings.length })}
      </h2>

      <ul className="mt-2 space-y-1.5">
        {[...errors, ...warnings].map((finding) => (
          <li key={`${finding.code}-${finding.elementId ?? ""}`}>
            <button
              type="button"
              disabled={onSelect === undefined || finding.elementId === undefined}
              onClick={() => finding.elementId !== undefined && onSelect?.(finding.elementId)}
              className="flex w-full flex-wrap items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-xs
                hover:bg-ink-50 disabled:hover:bg-transparent"
            >
              <span
                className={[
                  "rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset",
                  finding.severity === "error"
                    ? "bg-red-50 text-red-800 ring-red-200"
                    : "bg-amber-50 text-amber-900 ring-amber-200",
                ].join(" ")}
              >
                {t(`preview.diagnostics.severity.${finding.severity}` as "preview.diagnostics.severity.error")}
              </span>
              <span className="text-ink-800">{finding.detail}</span>
              <span className="text-ink-500">{finding.ranges.map(formatRange).join(", ")}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
