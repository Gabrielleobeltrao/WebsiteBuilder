import type { BuilderDocumentInput } from "@websitebuilder/shared";
import { describe, expect, it } from "vitest";

import {
  beginTransaction,
  canRedo,
  canUndo,
  commit,
  createHistory,
  endTransaction,
  HISTORY_LIMIT,
  redo,
  reset,
  undo,
} from "./history";

const doc = (name: string) => ({ name }) as unknown as BuilderDocumentInput;

describe("history", () => {
  it("starts with nothing to undo or redo", () => {
    const state = createHistory(doc("a"));
    expect(canUndo(state)).toBe(false);
    expect(canRedo(state)).toBe(false);
  });

  it("undoes and redoes in order", () => {
    let state = createHistory(doc("a"));
    state = commit(state, doc("b"));
    state = commit(state, doc("c"));

    state = undo(state);
    expect(state.present).toEqual(doc("b"));
    state = undo(state);
    expect(state.present).toEqual(doc("a"));
    expect(canUndo(state)).toBe(false);

    state = redo(state);
    expect(state.present).toEqual(doc("b"));
    state = redo(state);
    expect(state.present).toEqual(doc("c"));
    expect(canRedo(state)).toBe(false);
  });

  it("drops the redo stack once a new edit is committed", () => {
    let state = createHistory(doc("a"));
    state = commit(state, doc("b"));
    state = undo(state);
    state = commit(state, doc("branch"));

    expect(canRedo(state)).toBe(false);
    expect(state.present).toEqual(doc("branch"));
  });

  it("keeps at most the documented number of entries", () => {
    let state = createHistory(doc("0"));
    for (let index = 1; index <= HISTORY_LIMIT + 25; index += 1) state = commit(state, doc(String(index)));

    expect(state.past).toHaveLength(HISTORY_LIMIT);
    expect(state.past[0]).toEqual(doc(String(HISTORY_LIMIT + 25 - HISTORY_LIMIT)));
  });

  it("collapses a transaction into one undo step", () => {
    let state = createHistory(doc("start"));
    state = beginTransaction(state, "drag");
    state = commit(state, doc("frame-1"));
    state = commit(state, doc("frame-2"));
    state = commit(state, doc("frame-3"));
    state = endTransaction(state);

    expect(state.present).toEqual(doc("frame-3"));
    state = undo(state);
    expect(state.present).toEqual(doc("start"));
  });

  it("leaves no empty step when a transaction changed nothing", () => {
    let state = createHistory(doc("start"));
    state = beginTransaction(state, "slider");
    state = endTransaction(state);
    expect(canUndo(state)).toBe(false);
  });

  it("ignores a nested begin so one interaction cannot open two steps", () => {
    let state = createHistory(doc("start"));
    state = beginTransaction(state, "outer");
    state = beginTransaction(state, "inner");
    state = commit(state, doc("changed"));
    state = endTransaction(state);

    expect(state.past).toHaveLength(1);
  });

  it("reset clears history so loading is never undoable", () => {
    let state = createHistory(doc("a"));
    state = commit(state, doc("b"));
    state = reset(doc("loaded"));

    expect(canUndo(state)).toBe(false);
    expect(canRedo(state)).toBe(false);
    expect(state.present).toEqual(doc("loaded"));
  });
});
