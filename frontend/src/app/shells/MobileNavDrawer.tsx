import { Menu, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";

import { useFocusTrap } from "@/hooks/useFocusTrap";

/**
 * The narrow-viewport half of a shell: a compact bar carrying the brand and one control that opens
 * the shell's navigation as a modal drawer.
 *
 * Shared by both shells rather than written twice. The behaviour that has to hold — focus trapped
 * while open, Escape closes and returns focus, a navigation closes the drawer so it never covers the
 * page it just opened — is the part that quietly diverges when each shell owns its own copy.
 */
export function MobileNavDrawer({
  id,
  label,
  brand,
  children,
}: {
  id: string;
  label: string;
  brand: ReactNode;
  /** The drawer's contents. Receives the close callback to hand to anything that navigates. */
  children: (close: () => void) => ReactNode;
}) {
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  const close = useCallback(() => setOpen(false), []);
  useFocusTrap(drawerRef, { active: open, onEscape: close });

  // A route change must never leave the drawer covering the page it navigated to.
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <>
      <header className="flex items-center justify-between border-b border-ink-100 px-4 py-3 lg:hidden">
        {brand}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls={id}
          aria-label={t("actions.openMenu")}
          className="rounded-md border border-ink-200 p-2 text-ink-700"
        >
          {/* The icon is decorative; the button's name comes from its label, so a screen reader
              announces the action rather than the glyph. */}
          <Menu aria-hidden size={20} />
        </button>
      </header>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label={t("actions.closeMenu")}
            onClick={close}
            className="absolute inset-0 size-full bg-ink-950/40"
          />
          <div
            id={id}
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className="absolute inset-y-0 left-0 w-72 max-w-[85vw] overflow-y-auto bg-white p-6 shadow-xl"
          >
            <div className="mb-4 flex justify-end">
              <button
                type="button"
                onClick={close}
                aria-label={t("actions.closeMenu")}
                className="rounded-md border border-ink-200 p-2 text-ink-700"
              >
                <X aria-hidden size={20} />
              </button>
            </div>
            {children(close)}
          </div>
        </div>
      )}
    </>
  );
}
