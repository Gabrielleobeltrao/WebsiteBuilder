import { Copy, MoveDown, MoveUp, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Repeatable items, edited without touching JSON.
 *
 * Every block with a list — FAQ questions, tab panels, icon rows, pricing plans, table rows — gets
 * the same four controls in the same order, so learning one list teaches all of them. Reordering is
 * a pair of buttons rather than a drag: a list of three items inside a 320-pixel panel is a place
 * where dragging is fiddly for everyone and impossible without a pointer.
 */
export function ItemsEditor<T>({
  label,
  items,
  onChange,
  create,
  describe,
  children,
  max = 30,
}: {
  label: string;
  items: readonly T[];
  onChange: (items: T[]) => void;
  /** A new, valid item. Never a partial one the schema would refuse. */
  create: () => T;
  /** What this row is called, for the controls that act on it. */
  describe: (item: T, index: number) => string;
  /** The item's own fields. */
  children: (item: T, update: (next: T) => void, index: number) => React.ReactNode;
  max?: number;
}) {
  const { t } = useTranslation("builder");

  const replace = (index: number, next: T) => onChange(items.map((item, position) => (position === index ? next : item)));

  const move = (index: number, target: number) => {
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(index, 1);
    if (moved === undefined) return;
    next.splice(target, 0, moved);
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-ink-700">{label}</p>

      <ul className="space-y-2">
        {items.map((item, index) => (
          <li key={index} className="rounded-md border border-ink-200 p-2">
            <div className="mb-2 flex items-center justify-between gap-1">
              <span className="truncate text-[11px] font-medium text-ink-600">{describe(item, index)}</span>
              <span className="flex shrink-0 gap-0.5">
                <IconAction
                  label={t("items.moveUp", { item: describe(item, index) })}
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  <MoveUp aria-hidden className="size-3.5" />
                </IconAction>
                <IconAction
                  label={t("items.moveDown", { item: describe(item, index) })}
                  disabled={index === items.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  <MoveDown aria-hidden className="size-3.5" />
                </IconAction>
                <IconAction
                  label={t("items.duplicate", { item: describe(item, index) })}
                  disabled={items.length >= max}
                  onClick={() => onChange([...items.slice(0, index + 1), structuredClone(item), ...items.slice(index + 1)])}
                >
                  <Copy aria-hidden className="size-3.5" />
                </IconAction>
                <IconAction
                  label={t("items.remove", { item: describe(item, index) })}
                  onClick={() => onChange(items.filter((_, position) => position !== index))}
                >
                  <Trash2 aria-hidden className="size-3.5" />
                </IconAction>
              </span>
            </div>

            <div className="space-y-2">{children(item, (next) => replace(index, next), index)}</div>
          </li>
        ))}
      </ul>

      <button
        type="button"
        disabled={items.length >= max}
        onClick={() => onChange([...items, create()])}
        className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-ink-300 px-2 py-1.5
          text-xs font-medium text-ink-600 hover:border-accent-500 hover:text-accent-700 disabled:opacity-50"
      >
        <Plus aria-hidden className="size-3.5" />
        {t("items.add", { item: label })}
      </button>
    </div>
  );
}

function IconAction({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded p-1 text-ink-500 hover:bg-ink-100 hover:text-ink-800 disabled:opacity-30"
    >
      {children}
    </button>
  );
}
