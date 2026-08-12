import type { ElementContext, ElementDefinition, ElementType } from "@websitebuilder/shared";
import { ChevronDown, ChevronRight, Search, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { CREATE_MIME } from "@/features/editor/canvas/dnd";
import { catalogEntries, groupEntries, matchesQuery, type CatalogEntry } from "./catalog";
import { catalogIcon } from "./catalogIcons";
import { readFavorites, readRecent, recordUse, switchFavorite } from "./catalogPreferences";

/**
 * The block catalog.
 *
 * Browsing it must never activate an optional module — only a committed placement does, which is
 * why nothing here dispatches on hover or drag start. What it owes a person is the ability to find
 * a block: nineteen blocks in six categories is past the point where a flat grid of icons is a list
 * you read rather than one you scan.
 *
 * Every block is reachable three ways: typed into the search field, opened from its category, or
 * picked from Recent. Each row can be dragged to a place or activated where it stands, and the
 * second is not a fallback — it is the deterministic one, and the panel says where it will land.
 */
export function ElementsPanel({
  onAdd,
  destination,
  context = "page",
  unavailable,
}: {
  onAdd?: (type: ElementType) => void;
  /** Human-readable name of where a click puts the element. */
  destination?: string;
  context?: ElementContext;
  /** Why a block cannot be inserted *right now*, given where it would go. */
  unavailable?: (definition: ElementDefinition) => string | undefined;
}) {
  const { t } = useTranslation("builder");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);
  const [recent, setRecent] = useState<readonly ElementType[]>(() => readRecent());
  const [favorites, setFavorites] = useState<readonly ElementType[]>(() => readFavorites());

  const entries = useMemo(
    () =>
      catalogEntries({
        context,
        label: (definition) => t(`elements.${definition.labelKey}` as "elements.text"),
        // Localised search terms, so "botão" finds the button in Portuguese and "cta" finds it in
        // either. The registry's own keywords are English and are searched as well.
        keywords: (definition) =>
          t(`catalog.keywords.${definition.type}` as "catalog.keywords.text", { defaultValue: "" })
            .split(",")
            .map((term) => term.trim())
            .filter((term) => term !== ""),
        ...(unavailable === undefined ? {} : { unavailable }),
      }),
    [context, t, unavailable],
  );

  const matching = entries.filter((entry) => matchesQuery(entry, query));
  const groups = groupEntries(matching);
  const byType = new Map(entries.map((entry) => [entry.definition.type, entry]));
  const searching = query.trim() !== "";

  const insert = (type: ElementType) => {
    onAdd?.(type);
    setRecent(recordUse(type));
  };

  const row = (entry: CatalogEntry, key: string) => (
    <Block
      key={key}
      entry={entry}
      disabled={onAdd === undefined || entry.unavailable !== undefined}
      favorite={favorites.includes(entry.definition.type)}
      onInsert={() => insert(entry.definition.type)}
      onToggleFavorite={() => setFavorites(switchFavorite(entry.definition.type))}
    />
  );

  const pinned = (types: readonly ElementType[]) =>
    types.map((type) => byType.get(type)).filter((entry): entry is CatalogEntry => entry !== undefined);

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="sr-only">{t("catalog.search")}</span>
        <span className="relative block">
          <Search aria-hidden className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-400" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("catalog.searchPlaceholder")}
            className="w-full rounded-md border border-ink-200 py-1.5 pl-7 pr-2 text-xs text-ink-900"
          />
        </span>
      </label>

      {!searching && favorites.length > 0 && (
        <Section title={t("catalog.favorites")}>{pinned(favorites).map((entry) => row(entry, `fav-${entry.definition.type}`))}</Section>
      )}

      {!searching && recent.length > 0 && (
        <Section title={t("catalog.recent")}>{pinned(recent).map((entry) => row(entry, `recent-${entry.definition.type}`))}</Section>
      )}

      {groups.length === 0 && <p className="px-1 text-[11px] text-ink-500">{t("catalog.noResults")}</p>}

      {groups.map((group) => {
        const open = searching || !collapsed.includes(group.category);
        return (
          <section key={group.category}>
            <h3>
              <button
                type="button"
                aria-expanded={open}
                onClick={() =>
                  setCollapsed((current) =>
                    current.includes(group.category)
                      ? current.filter((entry) => entry !== group.category)
                      : [...current, group.category],
                  )
                }
                className="flex w-full items-center gap-1 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500"
              >
                {open ? <ChevronDown aria-hidden className="size-3" /> : <ChevronRight aria-hidden className="size-3" />}
                {t(`catalog.categories.${group.category}` as "catalog.categories.layout")}
              </button>
            </h3>
            {open && <ul className="space-y-1">{group.entries.map((entry) => row(entry, entry.definition.type))}</ul>}
          </section>
        );
      })}

      {destination !== undefined && (
        <p aria-live="polite" className="text-[11px] text-ink-500">
          {t("elements.destination", { destination })}
        </p>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">{title}</h3>
      <ul className="space-y-1">{children}</ul>
    </section>
  );
}

function Block({
  entry,
  disabled,
  favorite,
  onInsert,
  onToggleFavorite,
}: {
  entry: CatalogEntry;
  disabled: boolean;
  favorite: boolean;
  onInsert: () => void;
  onToggleFavorite: () => void;
}) {
  const { t } = useTranslation("builder");
  const Icon = catalogIcon(entry.definition.icon);
  const { type } = entry.definition;

  return (
    <li className="flex items-center gap-1">
      <button
        type="button"
        draggable={!disabled}
        onDragStart={(event) => {
          event.dataTransfer.setData(CREATE_MIME, type);
          event.dataTransfer.effectAllowed = "copy";
        }}
        disabled={disabled}
        // Explained rather than merely greyed out: a control that refuses without saying why reads
        // as a bug.
        title={entry.unavailable}
        aria-describedby={entry.unavailable === undefined ? undefined : `${type}-unavailable`}
        onClick={onInsert}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-ink-200 px-2 py-1.5 text-left text-xs
          font-medium text-ink-700 hover:border-ink-300 hover:bg-ink-50 disabled:opacity-50"
      >
        <Icon aria-hidden className="size-4 shrink-0 text-ink-500" />
        <span className="truncate">{entry.label}</span>
      </button>

      <button
        type="button"
        aria-label={favorite ? t("catalog.unfavorite", { block: entry.label }) : t("catalog.favorite", { block: entry.label })}
        aria-pressed={favorite}
        onClick={onToggleFavorite}
        className="rounded p-1 text-ink-400 hover:bg-ink-50 hover:text-ink-700"
      >
        <Star aria-hidden className={`size-3.5 ${favorite ? "fill-current text-amber-500" : ""}`} />
      </button>

      {entry.unavailable !== undefined && (
        <span id={`${type}-unavailable`} className="sr-only">
          {entry.unavailable}
        </span>
      )}
    </li>
  );
}

export type { ElementDefinition };
