import type { BuilderElement } from "@websitebuilder/shared";
import { cloneElement, isValidElement, type CSSProperties, type ReactElement } from "react";

import { appearanceStyle } from "./styles";

/**
 * Puts a block's colours on the box that block actually draws.
 *
 * Deliberately not on the element wrapper `ElementRenderer` emits. A background there paints a
 * full-width band behind an inline control — the download button is the block that makes this
 * obvious — which is not what anybody choosing "background" is asking for. Merging into the rendered
 * root instead means the colour lands on the `<a>`, the `<table>`, the `<nav>`: whatever the renderer
 * decided its own box was.
 *
 * Merged over the renderer's own style, not under it. The blocks that own their colours are exactly
 * the blocks the inspector does not offer this for, so there is nothing here to lose a fight with —
 * and losing to a hardcoded value would mean a control that is offered, stored, published and
 * invisible, which is the failure the tests beside this file are named after.
 */
export function withAppearance(element: BuilderElement, inner: ReactElement | null): ReactElement | null {
  const appearance = appearanceStyle(element);
  if (inner === null || Object.keys(appearance).length === 0 || !isValidElement(inner)) return inner;

  // A component root has no style prop to merge into, so it gets a box of its own rather than
  // silently dropping a setting the inspector offered.
  if (typeof inner.type !== "string") return <div style={appearance}>{inner}</div>;

  const props = inner.props as { style?: CSSProperties };
  return cloneElement(inner as ReactElement<{ style?: CSSProperties }>, {
    style: { ...props.style, ...appearance },
  });
}
