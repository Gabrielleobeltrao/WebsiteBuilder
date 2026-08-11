import { type DeviceMode, type ValueOrigin } from "@websitebuilder/shared";
import { RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * The badge beside a responsive field.
 *
 * A number in a device-aware inspector is ambiguous without it: 1100 might be what this device was
 * given, or what it inherited from a wider one, and those need different actions. Only an override
 * can be reset, so the reset control appears only where there is something to give back.
 */
export function DeviceValue({
  origin,
  source,
  onReset,
}: {
  origin: ValueOrigin;
  source: DeviceMode | null;
  onReset?: () => void;
}) {
  const { t } = useTranslation("builder");

  if (origin === "base" || (origin === "override" && source === "desktop")) return null;

  return (
    <span className="mt-0.5 flex items-center gap-1 text-[10px] text-ink-500">
      {origin === "inherited"
        ? t("responsive.origin.inherited", { breakpoint: t(`responsive.preset.${source ?? "desktop"}`) })
        : t("responsive.origin.override")}
      {origin === "override" && onReset !== undefined && (
        <button
          type="button"
          onClick={onReset}
          aria-label={t("responsive.reset")}
          title={t("responsive.reset")}
          className="rounded p-0.5 text-ink-500 hover:bg-ink-100 hover:text-ink-800"
        >
          <RotateCcw aria-hidden size={11} />
        </button>
      )}
    </span>
  );
}
