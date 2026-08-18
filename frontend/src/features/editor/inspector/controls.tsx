import { LENGTH_UNITS, serializeLength, type LengthUnit, type ResponsiveLength } from "@websitebuilder/shared";
import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useEditorStore } from "@/features/editor/store/editorStore";

/**
 * Shared inspector primitives.
 *
 * Two rules are enforced here rather than in every inspector, because that is the only way they
 * stay true as element types multiply:
 *
 * 1. Continuous controls (text fields, sliders, colour drags) open one history transaction on focus
 *    or pointer down and commit it on blur or pointer up. Without this, typing a heading produces
 *    one undo entry per keystroke.
 * 2. Disclosure and scroll state are component state, never document state — UI preferences must
 *    not end up persisted in the builder document.
 */

export type InspectorGroupKey =
  | "content"
  | "style"
  | "appearance"
  | "layout"
  | "responsive"
  | "advanced"
  | "canvas"
  | "seo";

/** The three tabs an inspector offers, stable for every element type. */
export type InspectorTab = "content" | "style" | "advanced";

/**
 * Which tab each group belongs to.
 *
 * Layout and responsive sizing are style decisions, not a separate navigation mode — grouping them
 * under Style is what lets the inspector be three tabs instead of five, without any control losing
 * its home.
 */
export const GROUP_TAB: Record<InspectorGroupKey, InspectorTab> = {
  content: "content",
  style: "style",
  // Colours are a style decision, so the shared pair sits beside the styling a block owns itself.
  appearance: "style",
  layout: "style",
  responsive: "style",
  advanced: "advanced",
  // Settings-panel groups. They never appear inside a tabbed inspector; the mapping exists so the
  // record stays total and a future group cannot be added without deciding where it belongs.
  canvas: "style",
  seo: "content",
};

/**
 * The tab currently shown, when these groups are inside a tabbed inspector.
 *
 * `null` — the default — means no tabs are in play and every group renders, which is how the same
 * groups keep working inside a plain settings panel.
 */
export const InspectorTabContext = createContext<InspectorTab | null>(null);

export function InspectorGroup({
  titleKey,
  children,
  defaultOpen = true,
}: {
  titleKey: InspectorGroupKey;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const { t } = useTranslation("builder");
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  const tab = useContext(InspectorTabContext);

  if (tab !== null && GROUP_TAB[titleKey] !== tab) return null;

  return (
    <section className="border-b border-ink-100 py-3 last:border-b-0">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((current) => !current)}
          className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide
            text-ink-500"
        >
          {t(`inspector.${titleKey}`)}
          <span aria-hidden>{open ? "−" : "+"}</span>
        </button>
      </h3>
      {open && (
        <div id={contentId} className="mt-3 space-y-3">
          {children}
        </div>
      )}
    </section>
  );
}

/** Text input that groups an entire editing burst into one undo step. */
export function TextField({
  label,
  value,
  transactionKey,
  onChange,
  multiline = false,
}: {
  label: string;
  value: string;
  transactionKey: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  const store = useEditorStore();
  const id = useId();
  const shared = {
    id,
    value,
    onFocus: () => store.beginTransaction(transactionKey),
    onBlur: () => store.endTransaction(),
    onChange: (event: { target: { value: string } }) => onChange(event.target.value),
    className: "mt-1 w-full rounded-md border border-ink-200 px-2 py-1.5 text-sm text-ink-900",
  };

  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-ink-700">
        {label}
      </label>
      {multiline ? <textarea {...shared} rows={3} /> : <input {...shared} type="text" />}
    </div>
  );
}

export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  transactionKey,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  transactionKey: string;
  onChange: (value: number) => void;
}) {
  const store = useEditorStore();
  const id = useId();
  // While the field has focus it holds its own text, so the user can clear it and retype. Without
  // this, refusing to commit an empty string leaves the old number stuck in a controlled input and
  // the next keystroke appends to it.
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-ink-700">
        {label}
      </label>
      <input
        id={id}
        type="number"
        value={draft ?? String(value)}
        min={min}
        max={max}
        step={step}
        onFocus={() => {
          store.beginTransaction(transactionKey);
          setDraft(String(value));
        }}
        onBlur={() => {
          setDraft(null);
          store.endTransaction();
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          const parsed = Number.parseFloat(event.target.value);
          // A partially typed value must not write NaN into the document, and a value outside the
          // control's own range must not either: storing one means the renderer silently falls back
          // to defaults, which looks to the user like the edit was ignored.
          if (!Number.isFinite(parsed)) return;
          onChange(Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, parsed)));
        }}
        className="mt-1 w-full rounded-md border border-ink-200 px-2 py-1.5 text-sm text-ink-900"
      />
    </div>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-ink-700">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="mt-1 w-full rounded-md border border-ink-200 px-2 py-1.5 text-sm text-ink-900"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * A colour that may also be nothing.
 *
 * `<input type="color">` has no empty state — it always reports something — so a block whose colour
 * is optional needs a way back. Without one, choosing a background once is permanent, and "I want
 * the default again" becomes a question with no answer in the interface.
 */
export function OptionalColorField({
  label,
  value,
  transactionKey,
  onChange,
}: {
  label: string;
  value: string | undefined;
  transactionKey: string;
  onChange: (value: string | undefined) => void;
}) {
  const { t } = useTranslation("builder");

  return (
    <div>
      <ColorField
        label={label}
        value={value ?? "#000000"}
        transactionKey={transactionKey}
        onChange={onChange}
      />
      {value !== undefined && (
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className="mt-1 text-[11px] text-ink-500 underline underline-offset-2 hover:text-ink-800"
        >
          {t("fields.clearColor")}
        </button>
      )}
    </div>
  );
}

export function ColorField({
  label,
  value,
  transactionKey,
  onChange,
}: {
  label: string;
  value: string;
  transactionKey: string;
  onChange: (value: string) => void;
}) {
  const store = useEditorStore();
  const id = useId();

  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-ink-700">
        {label}
      </label>
      <input
        id={id}
        type="color"
        value={value.startsWith("#") ? value.slice(0, 7) : "#000000"}
        // A colour drag fires continuously; one transaction per interaction keeps undo usable.
        onPointerDown={() => store.beginTransaction(transactionKey)}
        onPointerUp={() => store.endTransaction()}
        onBlur={() => store.endTransaction()}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-8 w-full rounded-md border border-ink-200"
      />
    </div>
  );
}

/**
 * Structured length control. The unit comes from an allowlist and the value is a finite number, so
 * this control cannot produce an arbitrary CSS string no matter what is typed.
 */
export function LengthField({
  label,
  value,
  transactionKey,
  units = LENGTH_UNITS,
  onChange,
}: {
  label: string;
  value: ResponsiveLength;
  transactionKey: string;
  units?: readonly LengthUnit[];
  onChange: (value: ResponsiveLength) => void;
}) {
  const store = useEditorStore();
  const id = useId();
  const numeric = "value" in value ? value : null;

  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-ink-700">
        {label}
      </label>
      <div className="mt-1 flex gap-1">
        <input
          id={id}
          type="number"
          value={numeric?.value ?? 0}
          disabled={numeric === null}
          onFocus={() => store.beginTransaction(transactionKey)}
          onBlur={() => store.endTransaction()}
          onChange={(event) => {
            const next = Number.parseFloat(event.target.value);
            if (Number.isFinite(next) && numeric) onChange({ value: next, unit: numeric.unit });
          }}
          className="w-full rounded-md border border-ink-200 px-2 py-1.5 text-sm text-ink-900 disabled:bg-ink-50"
        />
        <select
          aria-label={`${label} unit`}
          value={numeric?.unit ?? "px"}
          disabled={numeric === null}
          onChange={(event) => {
            if (numeric) onChange({ value: numeric.value, unit: event.target.value as LengthUnit });
          }}
          className="rounded-md border border-ink-200 px-1 py-1.5 text-xs text-ink-900 disabled:bg-ink-50"
        >
          {units.map((unit) => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
        </select>
      </div>
      {numeric === null && <p className="mt-1 text-[11px] text-ink-500">{serializeLength(value)}</p>}
    </div>
  );
}

export function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 rounded border-ink-300"
      />
      <label htmlFor={id} className="text-xs font-medium text-ink-700">
        {label}
      </label>
    </div>
  );
}
