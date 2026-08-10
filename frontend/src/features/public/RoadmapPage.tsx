import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { PageMetadata } from "@/components/common/PageMetadata";
import { RoadmapStatusBadge } from "@/features/public/RoadmapStatusBadge";
import { ROADMAP_STATUSES, roadmapItemsByStatus, type RoadmapStatus } from "@/features/public/roadmap-data";

type Filter = RoadmapStatus | "all";

export function RoadmapPage() {
  const { t } = useTranslation("public");
  const [filter, setFilter] = useState<Filter>("all");
  const items = roadmapItemsByStatus(filter);

  return (
    <>
      <PageMetadata title={t("roadmap.metaTitle")} description={t("roadmap.metaDescription")} />

      <div className="px-6 py-12 sm:px-10 lg:px-16 lg:py-16">
        <div className="mx-auto max-w-4xl">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-950 sm:text-4xl">
            {t("roadmap.title")}
          </h1>
          <p className="mt-4 max-w-2xl text-ink-600">{t("roadmap.intro")}</p>

          <section aria-labelledby="legend-title" className="mt-10 rounded-xl border border-ink-200 bg-ink-50 p-5">
            <h2 id="legend-title" className="text-sm font-semibold text-ink-800">
              {t("roadmap.legend")}
            </h2>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              {ROADMAP_STATUSES.map((status) => (
                <div key={status} className="flex items-start gap-3">
                  <dt className="shrink-0">
                    <RoadmapStatusBadge status={status} />
                  </dt>
                  <dd className="text-sm text-ink-600">{t(`roadmap.statusDescription.${status}`)}</dd>
                </div>
              ))}
            </dl>
          </section>

          <fieldset className="mt-10">
            <legend className="text-sm font-semibold text-ink-800">{t("roadmap.filterLabel")}</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["all", ...ROADMAP_STATUSES] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                  className={[
                    "rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors",
                    filter === value
                      ? "bg-ink-900 text-white ring-ink-900"
                      : "bg-white text-ink-700 ring-ink-200 hover:bg-ink-50",
                  ].join(" ")}
                >
                  {value === "all" ? t("roadmap.allStatuses") : t(`roadmap.status.${value}`)}
                </button>
              ))}
            </div>
          </fieldset>

          {items.length === 0 ? (
            <p className="mt-10 rounded-lg border border-dashed border-ink-200 p-8 text-center text-ink-500">
              {t("roadmap.empty")}
            </p>
          ) : (
            <ul className="mt-8 space-y-4">
              {items.map((item) => (
                <li key={item.id} className="rounded-xl border border-ink-200 bg-white p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h2 className="font-display text-lg font-semibold text-ink-900">
                      {t(`roadmap.items.${item.id}.title`)}
                    </h2>
                    <RoadmapStatusBadge status={item.status} />
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-ink-600">
                    {t(`roadmap.items.${item.id}.description`)}
                  </p>
                  <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
                    <span>{t(`roadmap.category.${item.category}`)}</span>
                    <span>
                      {item.targetPeriod
                        ? `${t("roadmap.targetPeriod")}: ${item.targetPeriod}`
                        : t("roadmap.noTarget")}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          )}

          <section className="mt-14 rounded-xl bg-ink-900 p-8 text-white">
            <h2 className="font-display text-xl font-semibold">{t("roadmap.cta.title")}</h2>
            <Link
              to="/signup"
              className="mt-5 inline-block rounded-md bg-accent-500 px-5 py-3 text-sm font-semibold text-ink-950
                hover:bg-accent-400"
            >
              {t("roadmap.cta.action")}
            </Link>
          </section>
        </div>
      </div>
    </>
  );
}
