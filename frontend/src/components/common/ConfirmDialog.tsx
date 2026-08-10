import { useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useFocusTrap } from "@/hooks/useFocusTrap";

/**
 * One modal dialog for short blocking decisions. Long-lived work belongs on a route — this exists
 * for confirmations and small focused forms, and only one may be open at a time.
 */
export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation("dashboard");
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useFocusTrap(dialogRef, { active: props.open, onEscape: () => !props.busy && props.onCancel() });

  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={() => !props.busy && props.onCancel()}
        className="absolute inset-0 size-full cursor-default bg-ink-950/40"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        {...(props.description ? { "aria-describedby": descriptionId } : {})}
        className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
      >
        <h2 id={titleId} className="font-display text-lg font-semibold text-ink-900">
          {props.title}
        </h2>
        {props.description && (
          <p id={descriptionId} className="mt-2 text-sm leading-relaxed text-ink-600">
            {props.description}
          </p>
        )}
        {props.children && <div className="mt-4">{props.children}</div>}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={props.onCancel}
            disabled={props.busy}
            className="rounded-md border border-ink-200 px-4 py-2 text-sm font-medium text-ink-700
              hover:bg-ink-50 disabled:opacity-50"
          >
            {t("sites.cancel")}
          </button>
          <button
            type="button"
            onClick={props.onConfirm}
            disabled={props.busy}
            className={[
              "rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50",
              props.destructive ? "bg-red-600 hover:bg-red-700" : "bg-accent-600 hover:bg-accent-700",
            ].join(" ")}
          >
            {props.busy ? t("sites.saving") : props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
