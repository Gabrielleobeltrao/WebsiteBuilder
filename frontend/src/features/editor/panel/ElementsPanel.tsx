import { Image, MousePointerClick, Square, Type } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Library of addable blocks. Browsing it must never activate an optional module — only a committed
 * placement does, which is why this panel dispatches nothing on hover or drag start.
 *
 * Phase 4 wires the insertion actions; the library is listed here because the panel's mode machine
 * needs a real Elements view to switch to.
 */
const BLOCKS = [
  { type: "text", Icon: Type },
  { type: "image", Icon: Image },
  { type: "button", Icon: MousePointerClick },
  { type: "container", Icon: Square },
] as const;

export function ElementsPanel({ onAdd }: { onAdd?: (type: (typeof BLOCKS)[number]["type"]) => void }) {
  const { t } = useTranslation("builder");

  return (
    <div>
      <ul className="grid grid-cols-2 gap-2">
        {BLOCKS.map(({ type, Icon }) => (
          <li key={type}>
            <button
              type="button"
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
    </div>
  );
}
