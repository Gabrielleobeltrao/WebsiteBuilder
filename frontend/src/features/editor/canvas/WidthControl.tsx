import { DEVICE_ORDER, deviceReferenceWidth } from "@websitebuilder/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { selectEditingBreakpoint, useEditorStore } from "@/features/editor/store/editorStore";

/**
 * Continuous width control.
 *
 * Presets are shortcuts, not the supported set: the slider and the numeric input reach every width
 * between 320 and 1920, which is where layouts that "work on desktop and mobile" actually break.
 * Changing the width never touches the document — it only selects what is being authored.
 */
const PRESETS = DEVICE_ORDER.map((device) => ({ id: device, width: deviceReferenceWidth(device) }));

export function WidthControl() {
  const { t } = useTranslation("builder");
  const editingWidth = useEditorStore((state) => state.ui.editingWidth);
  const setEditingWidth = useEditorStore((state) => state.setEditingWidth);
  const breakpoint = useEditorStore(selectEditingBreakpoint);
  // Same reason as the inspector number fields: a controlled numeric input the user cannot clear
  // makes the next keystroke append to the old value.
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      {PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          aria-pressed={editingWidth === preset.width}
          onClick={() => setEditingWidth(preset.width)}
          className={[
            "rounded px-2 py-1 text-[11px] font-medium",
            editingWidth === preset.width ? "bg-ink-900 text-white" : "border border-ink-200 text-ink-600",
          ].join(" ")}
        >
          {t(`responsive.preset.${preset.id}`)}
        </button>
      ))}

      <label className="flex items-center gap-1 text-[11px] text-ink-600">
        <span className="sr-only">{t("responsive.canvasWidth")}</span>
        <input
          type="range"
          min={320}
          max={1920}
          step={10}
          value={editingWidth}
          onChange={(event) => setEditingWidth(Number(event.target.value))}
          aria-label={t("responsive.canvasWidth")}
          className="w-28"
        />
      </label>

      <label className="flex items-center gap-1 text-[11px] text-ink-600">
        {t("responsive.canvasWidth")}
        <input
          type="number"
          min={320}
          max={1920}
          value={draft ?? String(editingWidth)}
          onFocus={() => setDraft(String(editingWidth))}
          onBlur={() => setDraft(null)}
          onChange={(event) => {
            setDraft(event.target.value);
            const parsed = Number.parseInt(event.target.value, 10);
            if (Number.isFinite(parsed)) setEditingWidth(parsed);
          }}
          className="w-16 rounded border border-ink-200 px-1 py-0.5 text-[11px] text-ink-900"
        />
      </label>

      {breakpoint && (
        <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] text-ink-700">{breakpoint.name}</span>
      )}
    </div>
  );
}
