import { useTranslation } from "react-i18next";

import { useRelativeTime } from "@/hooks/useRelativeTime";
import type { PersistenceState } from "@/features/editor/store/editorStore";

/**
 * Persistent save state, never a disposable toast. A user who walked away must be able to look at
 * the bar and know whether their work is safe.
 */
export function SaveStateIndicator({
  persistence,
  onRetry,
  onResolveConflict,
}: {
  persistence: PersistenceState;
  onRetry: () => void;
  onResolveConflict: () => void;
}) {
  const { t } = useTranslation("builder");
  const formatRelative = useRelativeTime();

  const tone =
    persistence.status === "error" || persistence.status === "conflict"
      ? "text-red-700"
      : persistence.status === "dirty"
        ? "text-ink-600"
        : "text-ink-500";

  return (
    <p role="status" aria-live="polite" className={`flex items-center gap-2 text-xs ${tone}`}>
      {persistence.status === "clean" && t("saveState.clean")}
      {persistence.status === "dirty" && t("saveState.dirty")}
      {persistence.status === "saving" && t("saveState.saving")}
      {persistence.status === "saved" && t("saveState.saved", { when: formatRelative(persistence.at) })}

      {persistence.status === "error" && (
        <>
          {t("saveState.error")}
          <button type="button" onClick={onRetry} className="font-semibold underline underline-offset-2">
            {t("saveState.retry")}
          </button>
        </>
      )}

      {persistence.status === "conflict" && (
        <>
          {t("saveState.conflict")}
          <button type="button" onClick={onResolveConflict} className="font-semibold underline underline-offset-2">
            {t("saveState.reload")}
          </button>
        </>
      )}
    </p>
  );
}
