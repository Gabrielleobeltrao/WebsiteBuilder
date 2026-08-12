import { ICON_NAMES, type IconName } from "@websitebuilder/shared";

/**
 * The icons a published page may contain.
 *
 * Hand-written paths rather than an icon library, for two reasons that both matter here. The first
 * is safety: this file is the whole vocabulary, so there is no path by which a document supplies
 * SVG markup — the element stores a name from a closed list, and an unknown name renders nothing
 * rather than anything. The second is weight: a published page is served to strangers, and pulling
 * an icon package into public output would charge every visitor for a set of glyphs the page does
 * not use.
 *
 * Every path is drawn on a 24×24 grid with a 2px stroke, which is why one set of attributes fits
 * all of them.
 */
const PATHS: Record<IconName, string> = {
  "arrow-right": "M5 12h14M13 6l6 6-6 6",
  "arrow-left": "M19 12H5M11 18l-6-6 6-6",
  check: "M20 6 9 17l-5-5",
  close: "M18 6 6 18M6 6l12 12",
  "chevron-down": "m6 9 6 6 6-6",
  "chevron-up": "m18 15-6-6-6 6",
  mail: "M4 6h16v12H4zM4 7l8 6 8-6",
  phone: "M6 3h4l2 5-2.5 1.5a12 12 0 0 0 5 5L16 12l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2",
  "map-pin": "M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  star: "m12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9z",
  heart: "M12 20s-7-4.6-7-9.5A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.5C19 15.4 12 20 12 20z",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  download: "M12 4v11M7 12l5 5 5-5M5 20h14",
  "external-link": "M14 4h6v6M20 4 10 14M18 14v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  play: "M7 4l12 8-12 8z",
  menu: "M4 7h16M4 12h16M4 17h16",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
  alert: "M12 3 2 20h20L12 3zM12 10v4M12 17h.01",
};

/**
 * Renders one icon.
 *
 * Decorative by default: an icon beside a label repeats what the label already says, and a screen
 * reader announcing both reads the same thing twice. A `label` makes it meaningful instead — which
 * is what an icon standing alone as a link needs.
 */
export function BlockIcon({
  name,
  size,
  color,
  label,
}: {
  name: string;
  size: number;
  color?: string;
  label?: string;
}) {
  const path = PATHS[name as IconName];
  if (path === undefined) return null;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? "currentColor"}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(label === undefined || label === "" ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
    >
      <path d={path} />
    </svg>
  );
}

/** Every name this renderer draws. Exported so a contract test can hold it to the shared list. */
export const RENDERABLE_ICONS: readonly string[] = ICON_NAMES;
