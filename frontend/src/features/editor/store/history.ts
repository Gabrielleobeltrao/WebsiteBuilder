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
  /**
   * Open transaction. `pushed` records whether this interaction has already contributed an undo
   * step, so focusing a field and leaving without typing creates nothing.
   */
  transaction: { label: string; baseline: BuilderDocumentInput; pushed: boolean } | null;
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
    // The first real change inside an interaction contributes the single undo step; later ones
    // replace the present without stacking.
    if (history.transaction.pushed) return { ...history, present: next, future: [] };
    return {
      past: [...history.past, history.transaction.baseline].slice(-HISTORY_LIMIT),
      present: next,
      future: [],
      transaction: { ...history.transaction, pushed: true },
    };
  }
  const past = [...history.past, history.present].slice(-HISTORY_LIMIT);
  return { past, present: next, future: [], transaction: null };
}

/**
 * Opens a transaction. Nothing is pushed yet: merely focusing a field or pressing a slider must
 * not create an undo step, and only the first real change inside the interaction does.
 */
export function beginTransaction(history: HistoryState, label: string): HistoryState {
  if (history.transaction !== null) return history;
  return { ...history, transaction: { label, baseline: history.present, pushed: false } };
}

export function endTransaction(history: HistoryState): HistoryState {
  if (history.transaction === null) return history;
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
