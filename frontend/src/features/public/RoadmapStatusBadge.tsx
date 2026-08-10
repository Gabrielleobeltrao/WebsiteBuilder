import { useTranslation } from "react-i18next";

import type { RoadmapStatus } from "./roadmap-data";

/**
 * Status is always carried by text, not only by colour. The dot is decorative reinforcement, which
 * is what keeps the badge readable for colour-blind users and in high-contrast modes.
 */
const STYLES: Record<RoadmapStatus, { chip: string; dot: string }> = {
  released: { chip: "bg-accent-50 text-accent-800 ring-accent-200", dot: "bg-accent-600" },
  in_progress: { chip: "bg-ink-100 text-ink-800 ring-ink-300", dot: "bg-ink-700" },
  planned: { chip: "bg-white text-ink-700 ring-ink-200", dot: "bg-ink-400" },
  under_consideration: { chip: "bg-white text-ink-500 ring-ink-200", dot: "bg-ink-300" },
};

export function RoadmapStatusBadge({ status }: { status: RoadmapStatus }) {
  const { t } = useTranslation("public");
  const style = STYLES[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${style.chip}`}
    >
      <span aria-hidden className={`size-1.5 rounded-full ${style.dot}`} />
      {t(`roadmap.status.${status}`)}
    </span>
  );
}
