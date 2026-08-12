import {
  ELEMENT_CATEGORIES,
  ELEMENT_DEFINITIONS,
  elementsForContext,
  type ElementCategory,
  type ElementContext,
  type ElementDefinition,
  type ElementType,
} from "@websitebuilder/shared";

/**
 * What the block catalog shows, as a pure function of the registry and what the user typed.
 *
 * Kept out of the component so the two things worth being sure about — that a search finds a block
 * by either language's name, and that a block unavailable in this context is never offered — are
 * testable without rendering a panel.
 */

export type CatalogEntry = {
  definition: ElementDefinition;
  /** Localised name, already resolved by the caller so this file needs no i18n instance. */
  label: string;
  /** Localised search terms, including the label. */
  terms: readonly string[];
  /** Present when the block cannot be inserted right now, and says why. */
  unavailable?: string;
};

export type CatalogGroup = { category: ElementCategory; entries: readonly CatalogEntry[] };

/** How many blocks the Recent row remembers. Beyond this it stops being recent. */
export const RECENT_LIMIT = 6;

/**
 * Normalises for search: case-folded and without diacritics, so "botao" finds "Botão" and "icone"
 * finds "Ícone". Someone searching in a hurry does not type accents.
 */
export function normalizeTerm(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export function matchesQuery(entry: CatalogEntry, query: string): boolean {
  const needle = normalizeTerm(query);
  if (needle === "") return true;
  return entry.terms.some((term) => normalizeTerm(term).includes(needle));
}

/** The blocks available in a context, grouped in category order, with empty groups dropped. */
export function groupEntries(entries: readonly CatalogEntry[]): CatalogGroup[] {
  return ELEMENT_CATEGORIES.map((category) => ({
    category,
    entries: entries.filter((entry) => entry.definition.category === category),
  })).filter((group) => group.entries.length > 0);
}

/**
 * The catalog for one context.
 *
 * A block whose context does not include this one is absent rather than disabled: a blog-template
 * block on an ordinary page is not a permission the person can obtain, so offering it greyed out
 * would be a promise the product cannot keep.
 */
export function catalogEntries(input: {
  context: ElementContext;
  label: (definition: ElementDefinition) => string;
  keywords: (definition: ElementDefinition) => readonly string[];
  unavailable?: (definition: ElementDefinition) => string | undefined;
}): CatalogEntry[] {
  return elementsForContext(input.context).map((definition) => {
    const label = input.label(definition);
    const reason = input.unavailable?.(definition);
    return {
      definition,
      label,
      terms: [label, definition.type, ...definition.keywords, ...input.keywords(definition)],
      ...(reason === undefined ? {} : { unavailable: reason }),
    };
  });
}

/** Adds a block to the recent list, most recent first, without duplicates. */
export function rememberRecent(recent: readonly ElementType[], type: ElementType): ElementType[] {
  return [type, ...recent.filter((candidate) => candidate !== type)].slice(0, RECENT_LIMIT);
}

export function toggleFavorite(favorites: readonly ElementType[], type: ElementType): ElementType[] {
  return favorites.includes(type)
    ? favorites.filter((candidate) => candidate !== type)
    : [...favorites, type];
}

/** Keeps only types that still exist, so a stored preference cannot resurrect a removed block. */
export function pruneTypes(stored: readonly string[]): ElementType[] {
  const known = new Set(ELEMENT_DEFINITIONS.map((definition) => definition.type));
  return stored.filter((type): type is ElementType => known.has(type as ElementType));
}
