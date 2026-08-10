import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableWithin(container: HTMLElement): HTMLElement[] {
  // `hidden`/`aria-hidden` rather than `offsetParent`: layout-dependent visibility checks are not
  // reliable outside a real browser, and a focus trap that silently degrades in tests is useless.
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !element.hasAttribute("hidden") && element.closest("[aria-hidden='true']") === null,
  );
}

/**
 * Keeps keyboard focus inside an open overlay, closes it on Escape, and returns focus to whatever
 * opened it. Every overlay in the product uses this, so focus behaviour cannot drift between the
 * public drawer, dialogs and resource pickers.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  options: { active: boolean; onEscape: () => void },
): void {
  const { active, onEscape } = options;

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const initial = focusableWithin(container)[0] ?? container;
    initial.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onEscape();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = focusableWithin(container);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, [active, containerRef, onEscape]);
}
