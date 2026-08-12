import type { ElementType } from "@websitebuilder/shared";

import { pruneTypes, rememberRecent, toggleFavorite } from "./catalog";

/**
 * Which blocks this person reaches for.
 *
 * A preference, not content: it lives in the browser, never in the document, and never in a saved
 * revision. Two people editing the same site have their own; clearing it changes nothing anybody
 * else can see, which is exactly why it must not be stored in the project.
 */
const RECENT_KEY = "wb.catalog.recent";
const FAVORITES_KEY = "wb.catalog.favorites";

function read(storage: Storage | undefined, key: string): ElementType[] {
  try {
    const raw = storage?.getItem(key);
    if (raw === null || raw === undefined) return [];
    const parsed: unknown = JSON.parse(raw);
    // Pruned against the registry: a block removed by a deployment must not come back as a row that
    // inserts nothing.
    return Array.isArray(parsed) ? pruneTypes(parsed.filter((entry): entry is string => typeof entry === "string")) : [];
  } catch {
    // Private mode, a full quota, or a value somebody edited by hand. None is worth an error.
    return [];
  }
}

function write(storage: Storage | undefined, key: string, value: readonly ElementType[]): void {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Nothing here is worth interrupting authoring for.
  }
}

export function readRecent(storage: Storage | undefined = globalThis.localStorage): ElementType[] {
  return read(storage, RECENT_KEY);
}

export function readFavorites(storage: Storage | undefined = globalThis.localStorage): ElementType[] {
  return read(storage, FAVORITES_KEY);
}

export function recordUse(
  type: ElementType,
  storage: Storage | undefined = globalThis.localStorage,
): ElementType[] {
  const next = rememberRecent(readRecent(storage), type);
  write(storage, RECENT_KEY, next);
  return next;
}

export function switchFavorite(
  type: ElementType,
  storage: Storage | undefined = globalThis.localStorage,
): ElementType[] {
  const next = toggleFavorite(readFavorites(storage), type);
  write(storage, FAVORITES_KEY, next);
  return next;
}
