import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * Secondary actions, folded away until they are wanted.
 *
 * A row that shows every action it has is a row of four buttons, and on a phone four buttons wrap
 * into a block taller than the thing they act on — so a list becomes unreadable exactly where it is
 * read most. The one action people came for stays out here; the rest live behind this.
 *
 * A button with `aria-expanded` and `aria-controls`, matching the disclosure on the site cards, not
 * a `role="menu"`: an ARIA menu owes its users arrow keys, typeahead and focus containment, and one
 * that skips them is worse than the plain disclosure it was trying to improve on. Escape closes it
 * and returns focus, and a click elsewhere dismisses it rather than leaving a panel over the next
 * row.
 */
export function OverflowMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      // Back to the control that opened it, rather than to the top of the document.
      toggleRef.current?.focus();
    };

    const onPointerDown = (event: MouseEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target) === false) setOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        onClick={() => setOpen((current) => !current)}
        className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50"
      >
        <span aria-hidden>···</span>
      </button>

      <div
        id={panelId}
        hidden={!open}
        className="absolute right-0 z-10 mt-1 flex min-w-44 flex-col rounded-md border border-ink-200 bg-white p-1 shadow-lg"
      >
        {children}
      </div>
    </div>
  );
}
