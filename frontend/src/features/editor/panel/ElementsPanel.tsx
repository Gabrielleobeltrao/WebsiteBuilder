import type { ElementType } from "@websitebuilder/shared";
import { Image, MousePointerClick, Square, Type } from "lucide-react";
import { useTranslation } from "react-i18next";

import { CREATE_MIME } from "@/features/editor/canvas/dnd";

/**
 * Library of addable blocks. Browsing it must never activate an optional module — only a committed
 * placement does, which is why this panel dispatches nothing on hover or drag start.
 *
 * Every block can be dragged to a place on the canvas or activated where it stands. The second path
 * is not a fallback for people who cannot drag: it is the deterministic one, and the panel says
 * out loud where the element will land before anybody commits to it.
 */
const BLOCKS = [
  { type: "text", Icon: Type },
  { type: "image", Icon: Image },
  { type: "button", Icon: MousePointerClick },
  { type: "container", Icon: Square },
] as const;

export function ElementsPanel({
  onAdd,
  destination,
}: {
  onAdd?: (type: ElementType) => void;
  /** Human-readable name of where a click puts the element. */
  destination?: string;
}) {
  const { t } = useTranslation("builder");

  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-2 gap-2">
        {BLOCKS.map(({ type, Icon }) => (
          <li key={type}>
            <button
              type="button"
              draggable={onAdd !== undefined}
              onDragStart={(event) => {
                event.dataTransfer.setData(CREATE_MIME, type);
                event.dataTransfer.effectAllowed = "copy";
              }}
              disabled={onAdd === undefined}
              onClick={() => onAdd?.(type)}
              className="flex w-full flex-col items-center gap-2 rounded-lg border border-ink-200 p-3 text-xs
                font-medium text-ink-700 hover:border-ink-300 hover:bg-ink-50 disabled:opacity-50"
            >
              <Icon aria-hidden className="size-5 text-ink-500" />
              {t(`elements.${type}`)}
            </button>
          </li>
        ))}
      </ul>

      {destination !== undefined && (
        <p aria-live="polite" className="text-[11px] text-ink-500">
          {t("elements.destination", { destination })}
        </p>
      )}
    </div>
  );
}
