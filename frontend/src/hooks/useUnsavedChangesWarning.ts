import { useEffect } from "react";

/**
 * Warns before the browser discards unsaved work. Browsers ignore custom text here, so the message
 * lives in the in-app dialogs; this only ensures the native prompt appears at all.
 */
export function useUnsavedChangesWarning(hasUnsavedChanges: boolean): void {
  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    globalThis.addEventListener("beforeunload", onBeforeUnload);
    return () => globalThis.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedChanges]);
}
