import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

/**
 * jsdom implements `<dialog>`'s markup but none of its behaviour, so a component that uses the
 * platform's own modal would be untestable here. This stands in for `showModal`/`close` closely
 * enough to exercise open and close logic and focus restoration; the focus trap and Escape handling
 * it does not simulate are the browser's, and are exactly why the real element is used.
 */
if (typeof HTMLDialogElement !== "undefined" && HTMLDialogElement.prototype.showModal === undefined) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
}

/**
 * Console output is part of the test result.
 *
 * React reports a state update outside `act(...)`, a duplicated extension, an invalid prop value —
 * `left="NaN"` among them — through `console.error`, and a suite that prints those and still passes
 * is a suite that has stopped reporting. So an unexpected `console.error` or `console.warn` fails
 * the test that produced it.
 *
 * A test that means to provoke one declares it with `allowConsole(/pattern/)`. That is deliberately
 * per-test and pattern-matched: an allowance broad enough to cover everything would restore exactly
 * the silence this replaces.
 */
let allowed: RegExp[] = [];
let unexpected: string[] = [];

export function allowConsole(...patterns: RegExp[]): void {
  allowed.push(...patterns);
}

const record = (method: "error" | "warn", original: (...args: unknown[]) => void) =>
  (...args: unknown[]) => {
    const text = args
      .map((argument) => (argument instanceof Error ? argument.message : String(argument)))
      .join(" ");
    if (!allowed.some((pattern) => pattern.test(text))) unexpected.push(`console.${method}: ${text}`);
    original(...args);
  };

// Captured once, before any spy exists. Reading `console.error` after `spyOn` has replaced it hands
// the wrapper itself as the "original", and the first call recurses until the stack ends.
const realError = console.error.bind(console);
const realWarn = console.warn.bind(console);

let spies: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
  allowed = [];
  unexpected = [];
  // Restored individually rather than through `vi.restoreAllMocks()`: that also resets every
  // `vi.fn()` a module mock declared, so the second test in a file would find its stubs empty.
  spies = [
    vi.spyOn(console, "error").mockImplementation(record("error", realError)),
    vi.spyOn(console, "warn").mockImplementation(record("warn", realWarn)),
  ];
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();

  const reported = [...unexpected];
  unexpected = [];
  for (const spy of spies) spy.mockRestore();
  spies = [];

  if (reported.length > 0) {
    throw new Error(
      `Unexpected console output. Fix the cause, or declare it with allowConsole():\n${reported.join("\n")}`,
    );
  }
});
