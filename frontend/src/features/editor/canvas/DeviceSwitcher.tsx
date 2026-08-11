import { DEVICE_ORDER, deviceReferenceWidth, type DeviceMode } from "@websitebuilder/shared";
import { Monitor, Smartphone, Tablet } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { selectEditingDevice, useEditorStore } from "@/features/editor/store/editorStore";

/**
 * Desktop, Tablet, Mobile. Nothing else.
 *
 * This replaced a slider, a numeric width field and a breakpoint badge. The continuum was honest
 * about the problem — layouts break at widths nobody names — and useless as a control, because it
 * asked an author to decide which of 1600 widths to author for, a question the product cannot help
 * them answer. The sweep that finds breaks between the presets still runs; it belongs to
 * diagnostics, not to a person's hands.
 *
 * Switching devices never touches the document. It selects what is being authored, and the writes
 * that follow are what land on that device.
 */
const ICONS: Record<DeviceMode, typeof Monitor> = { desktop: Monitor, tablet: Tablet, mobile: Smartphone };

export function DeviceSwitcher() {
  const { t } = useTranslation("builder");
  const device = useEditorStore(selectEditingDevice);
  const setEditingDevice = useEditorStore((state) => state.setEditingDevice);
  const autoFit = useEditorStore((state) => state.autoFitCurrentPage);
  const [result, setResult] = useState<string | null>(null);

  return (
    <div role="group" aria-label={t("responsive.device")} className="flex items-center gap-1">
      {DEVICE_ORDER.map((candidate) => {
        const Icon = ICONS[candidate];
        const label = t(`responsive.preset.${candidate}`);
        return (
          <button
            key={candidate}
            type="button"
            // `aria-pressed` rather than a visual highlight alone: which device is being authored
            // decides where every following edit lands, so it has to be announced, not implied.
            aria-pressed={device === candidate}
            aria-label={`${label} · ${deviceReferenceWidth(candidate)}px`}
            title={`${label} · ${deviceReferenceWidth(candidate)}px`}
            onClick={() => setEditingDevice(candidate)}
            className={[
              "rounded p-1.5",
              device === candidate ? "bg-ink-900 text-white" : "border border-ink-200 text-ink-600 hover:bg-ink-50",
            ].join(" ")}
          >
            <Icon aria-hidden size={16} />
          </button>
        );
      })}

      {/*
        Never automatic. The system can compute a safe placement, and computing one on every render
        would move an author's work while they watched — so it happens when somebody asks, on the
        device they are looking at, as one undoable step.
      */}
      {device !== "desktop" && (
        <button
          type="button"
          onClick={() => {
            const changed = autoFit();
            setResult(changed === 0 ? t("responsive.autoFixNothing") : t("responsive.autoFixDone", { count: changed }));
          }}
          title={t("responsive.autoFixHint")}
          className="rounded border border-ink-200 px-2 py-1 text-[11px] font-medium text-ink-700 hover:bg-ink-50"
        >
          {t("responsive.autoFix")}
        </button>
      )}

      {result !== null && (
        <span role="status" className="text-[11px] text-ink-600">
          {result}
        </span>
      )}
    </div>
  );
}
