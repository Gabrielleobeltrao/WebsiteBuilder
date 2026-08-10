import type { BuilderDocumentInput } from "@websitebuilder/shared";

/**
 * Undo history over whole-document snapshots.
 *
 * Snapshots are the boring choice: correct by construction, trivially reversible, and cheap enough
 * at the plan's 100-entry limit for documents of the size this product produces. Patch-based
 * history is the optimisation to reach for only once a measurement says memory is a real problem.
 *
 * Only document mutations enter history. Selection, zoom and panel state deliberately do not, so
 * clicking around never buries the user's last real edit under UI noise.
 */
export const HISTORY_LIMIT = 100;

export type HistoryState = {
  past: BuilderDocumentInput[];
  present: BuilderDocumentInput;
  future: BuilderDocumentInput[];
  /** Open transaction label; while set, commits replace the pending entry instead of stacking. */
  transaction: string | null;
};

export function createHistory(present: BuilderDocumentInput): HistoryState {
  return { past: [], present, future: [], transaction: null };
}

export function canUndo(history: HistoryState): boolean {
  return history.past.length > 0;
}

export function canRedo(history: HistoryState): boolean {
  return history.future.length > 0;
}

/**
 * Records a new document state. Inside an open transaction the previous state is not pushed again,
 * so a slider drag or a burst of keystrokes collapses into one undo step.
 */
export function commit(history: HistoryState, next: BuilderDocumentInput): HistoryState {
  if (history.transaction !== null) {
    return { ...history, present: next, future: [] };
  }
  const past = [...history.past, history.present].slice(-HISTORY_LIMIT);
  return { past, present: next, future: [], transaction: null };
}

/** Opens a transaction: the first commit inside it pushes history, later ones replace it. */
export function beginTransaction(history: HistoryState, label: string): HistoryState {
  if (history.transaction !== null) return history;
  const past = [...history.past, history.present].slice(-HISTORY_LIMIT);
  return { ...history, past, future: [], transaction: label };
}

export function endTransaction(history: HistoryState): HistoryState {
  if (history.transaction === null) return history;
  // A transaction that changed nothing must not leave an empty undo step behind.
  const previous = history.past[history.past.length - 1];
  if (previous !== undefined && previous === history.present) {
    return { ...history, past: history.past.slice(0, -1), transaction: null };
  }
  return { ...history, transaction: null };
}

export function undo(history: HistoryState): HistoryState {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future].slice(0, HISTORY_LIMIT),
    transaction: null,
  };
}

export function redo(history: HistoryState): HistoryState {
  const next = history.future[0];
  if (next === undefined) return history;
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future: history.future.slice(1),
    transaction: null,
  };
}

/** Replaces the document without recording history — used by load and by a successful save. */
export function reset(present: BuilderDocumentInput): HistoryState {
  return createHistory(present);
}
