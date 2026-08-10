import {
  resolveSafeLinkHref,
  type BuilderElement,
  type ButtonElement,
  type ContainerElement,
  type ImageElement,
  type TextElement,
} from "@websitebuilder/shared";
import { createElement } from "react";

import { useRendererContext } from "./RendererContext";
import { buttonStyle, freeGeometryStyle, imageStyle, isRenderable, textStyle } from "./styles";

/**
 * Pure presentational renderers. No selection logic, no store access, no editor chrome — the editor
 * wraps these with its own interaction layer so preview and published output render exactly what
 * the user designed and nothing else.
 */

export function TextRenderer({ element }: { element: TextElement }) {
  // Content is a text child, never HTML. This is the property that makes user text safe by
  // construction rather than by sanitisation.
  return createElement(element.tag, { style: textStyle(element) }, element.content);
}

export function ImageRenderer({ element }: { element: ImageElement }) {
  const { resolveMediaUrl } = useRendererContext();

  // An empty URL is treated as no source: rendering src="" makes the browser refetch the page.
  const src =
    element.source.kind === "url"
      ? (element.source.url.trim() || null)
      : element.source.kind === "media"
        ? resolveMediaUrl(element.source.mediaId)
        : null;

  if (src === null) {
    // A missing or broken source renders a neutral placeholder instead of a broken-image icon.
    return <div style={{ ...imageStyle(element), backgroundColor: "#eceef2" }} role="presentation" />;
  }

  return (
    <img
      src={src}
      alt={element.decorative ? "" : element.alt}
      {...(element.decorative ? { role: "presentation" } : {})}
      loading="lazy"
      decoding="async"
      style={imageStyle(element)}
    />
  );
}

export function ButtonRenderer({ element }: { element: ButtonElement }) {
  const { resolvePagePath, allowHttp } = useRendererContext();
  const resolved = resolveSafeLinkHref(element.link, {
    resolvePagePath,
    ...(allowHttp === undefined ? {} : { allowHttp }),
  });

  const content = <span>{element.text}</span>;

  // An unconfigured or broken link renders a non-navigating button. Nothing is silently linked to
  // the wrong place, and no unsafe href can ever be produced.
  if (resolved === null) {
    return (
      <button type="button" style={buttonStyle(element)} disabled>
        {content}
      </button>
    );
  }

  return (
    <a
      href={resolved.href}
      {...(resolved.target ? { target: resolved.target } : {})}
      {...(resolved.rel ? { rel: resolved.rel } : {})}
      style={buttonStyle(element)}
    >
      {content}
    </a>
  );
}

export function ContainerRenderer({ element }: { element: ContainerElement }) {
  const style =
    element.layout === "grid"
      ? { display: "grid" as const }
      : element.layout === "flex"
        ? { display: "flex" as const }
        : { position: "relative" as const };

  return (
    <div style={style}>
      {element.children.filter(isRenderable).map((child) => (
        <ElementRenderer key={child.id} element={child} />
      ))}
    </div>
  );
}

/** Positions an element inside a free section and dispatches to its type renderer. */
export function ElementRenderer({ element, positioned = true }: { element: BuilderElement; positioned?: boolean }) {
  if (!isRenderable(element)) return null;

  const inner =
    element.type === "text" ? (
      <TextRenderer element={element} />
    ) : element.type === "image" ? (
      <ImageRenderer element={element} />
    ) : element.type === "button" ? (
      <ButtonRenderer element={element} />
    ) : (
      <ContainerRenderer element={element} />
    );

  if (!positioned) return inner;

  return (
    <div style={{ ...freeGeometryStyle(element.geometry), zIndex: element.zIndex }} data-element-id={element.id}>
      {inner}
    </div>
  );
}
