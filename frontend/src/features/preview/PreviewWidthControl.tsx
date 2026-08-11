import {
  clampPreviewWidth,
  DEVICE_PRESETS,
  MAX_PREVIEW_WIDTH,
  MIN_PREVIEW_WIDTH,
} from "@websitebuilder/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Continuous preview width.
 *
 * The slider and the number field edit the same value, and both clamp to the range the diagnostics
 * sweep actually covers — offering a width nothing was checked at would imply a guarantee that does
 * not exist.
 *
 * The number field keeps its own draft while being typed. A controlled numeric input that clamps on
 * every keystroke makes clearing it impossible: the old value stays, the next digit appends to it,
 * and the field fights the person using it.
 */
export function PreviewWidthControl({
  width,
  onChange,
}: {
  width: number;
  onChange: (width: number) => void;
}) {
  const { t } = useTranslation("builder");
  const [draft, setDraft] = useState(String(width));

  useEffect(() => {
    setDraft(String(width));
  }, [width]);

  const commit = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    // An unparseable draft reverts rather than jumping to a clamped guess.
    onChange(Number.isNaN(parsed) ? width : clampPreviewWidth(parsed));
  };

  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <div className="flex gap-1">
        {DEVICE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            aria-pressed={width === preset.width}
            onClick={() => onChange(preset.width)}
            className={[
              "rounded-md px-2.5 py-1 text-xs font-medium",
              width === preset.width ? "bg-ink-900 text-white" : "border border-ink-200 text-ink-700",
            ].join(" ")}
          >
            {t(`preview.presets.${preset.id}` as "preview.presets.phone")}
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2 text-xs text-ink-700">
        <span className="sr-only">{t("preview.width")}</span>
        <input
          type="range"
          min={MIN_PREVIEW_WIDTH}
          max={MAX_PREVIEW_WIDTH}
          step={1}
          value={width}
          aria-label={t("preview.width")}
          onChange={(event) => onChange(clampPreviewWidth(Number(event.target.value)))}
          className="w-48"
        />
      </label>

      <label className="flex items-center gap-1 text-xs text-ink-700">
        <span className="sr-only">{t("preview.exactWidth")}</span>
        <input
          type="number"
          inputMode="numeric"
          min={MIN_PREVIEW_WIDTH}
          max={MAX_PREVIEW_WIDTH}
          value={draft}
          aria-label={t("preview.exactWidth")}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit((event.target as HTMLInputElement).value);
          }}
          className="w-20 rounded-md border border-ink-200 px-2 py-1 text-right text-xs"
        />
        <span aria-hidden>px</span>
      </label>
    </div>
  );
}
