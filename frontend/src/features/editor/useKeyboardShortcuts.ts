import { useEffect } from "react";

import { useEditorStore } from "@/features/editor/store/editorStore";

/**
 * Canvas shortcuts, with the guard that matters most: while the user is typing in an input,
 * textarea or contenteditable, Delete and the undo/redo chords belong to that field. Without this,
 * backspacing a typo silently deletes the selected element.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function useKeyboardShortcuts(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const store = useEditorStore.getState();
      const editing = isEditableTarget(event.target);
      const modifier = event.metaKey || event.ctrlKey;
      const selectedId = store.ui.selection?.kind === "element" ? store.ui.selection.elementId : null;

      // Escape clears the selection; it is handled before the editable guard because leaving a
      // field is exactly what a user expects it to do first.
      if (event.key === "Escape" && !editing) {
        store.select(null);
        return;
      }

      if (modifier && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void store.save();
        return;
      }

      if (editing) return;

      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (modifier && event.key.toLowerCase() === "y") {
        event.preventDefault();
        store.redo();
        return;
      }

      // Paste needs no selection: it places the clipboard into the current page.
      if (modifier && event.key.toLowerCase() === "v") {
        event.preventDefault();
        store.paste();
        return;
      }

      if (selectedId === null) return;

      if (modifier && event.key.toLowerCase() === "c") {
        event.preventDefault();
        store.copySelection();
        return;
      }
      if (modifier && event.key.toLowerCase() === "x") {
        event.preventDefault();
        store.cutSelection();
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        store.deleteElement(selectedId);
        return;
      }
      if (modifier && event.key.toLowerCase() === "d") {
        event.preventDefault();
        store.duplicateElement(selectedId);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
