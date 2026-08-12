import { Files, Globe, Layers, Plus, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { PanelMode } from "@/features/editor/store/editorStore";
import { NON_INSPECTOR_MODES } from "./panelMachine";

/**
 * The builder's five destinations, as a narrow vertical rail on the outer edge.
 *
 * It replaces a row of five compressed text tabs, which had two costs a rail does not: the labels
 * were truncated to fit, and every destination added shrank the others. The rail's width is fixed
 * and independent of how many destinations exist, so the panel beside it — and therefore the canvas
 * — never moves.
 *
 * The label is not decoration that was dropped: it is the button's accessible name, its tooltip, and
 * the heading of the panel it opens.
 */
const RAIL_ICONS: Record<PanelMode, LucideIcon> = {
  elements: Plus,
  pages: Files,
  layers: Layers,
  pageSettings: SlidersHorizontal,
  siteSettings: Globe,
};

export function PanelRail({ active, onChange }: { active: PanelMode; onChange: (mode: PanelMode) => void }) {
  const { t } = useTranslation("builder");

  return (
    <div
      role="tablist"
      aria-orientation="vertical"
      aria-label={t("panel.destinations")}
      className="flex w-12 shrink-0 flex-col gap-1 border-l border-ink-100 bg-ink-50 p-2"
    >
      {NON_INSPECTOR_MODES.map((mode) => {
        const Icon = RAIL_ICONS[mode];
        const label = t(`panel.${mode}`);
        return (
          <button
            key={mode}
            role="tab"
            type="button"
            aria-selected={active === mode}
            aria-label={label}
            title={label}
            onClick={() => onChange(mode)}
            className={[
              "flex items-center justify-center rounded-md p-2",
              active === mode ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-100",
            ].join(" ")}
          >
            <Icon aria-hidden className="size-4" />
          </button>
        );
      })}
    </div>
  );
}
