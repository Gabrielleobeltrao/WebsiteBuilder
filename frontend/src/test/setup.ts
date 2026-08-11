import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

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

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});
