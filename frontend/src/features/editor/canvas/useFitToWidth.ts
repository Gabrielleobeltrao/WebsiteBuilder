import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { fitZoom } from "@/features/editor/canvas/coordinates";

/**
 * Measures the space the canvas has, and the zoom that brings the whole page into it.
 *
 * The builder drew the page at its authored width — 1440 on desktop — inside whatever the window had
 * left after the panel, and nothing ever set the zoom, so the right-hand third of a desktop layout
 * sat off-screen behind a horizontal scrollbar. `fitZoom` and the conversion helpers around it were
 * written for exactly this and never wired to anything.
 *
 * Measured rather than derived from the window: the space depends on the panel, and the panel now
 * collapses.
 */
export function useFitToWidth(editingWidth: number): {
  ref: React.RefObject<HTMLDivElement | null>;
  available: number | null;
  zoom: number;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<number | null>(null);

  // clientWidth excludes the scrollbar, which is the width a page can actually occupy.
  const measure = useCallback(() => {
    if (ref.current !== null) setAvailable(ref.current.clientWidth);
  }, []);

  useLayoutEffect(() => {
    measure();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measure);
    if (ref.current !== null) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  // 64 is the `p-8` gutter on both sides of the scroll container.
  return { ref, available, zoom: available === null ? 1 : fitZoom(available, 64, editingWidth) };
}
