import {
  buildSizes,
  buildSrcSet,
  resolveSafeLinkHref,
  type BuilderElement,
  type ButtonElement,
  type ContainerElement,
  type ImageElement,
  type TextElement,
} from "@websitebuilder/shared";
import { createElement } from "react";

import { useRendererContext } from "./RendererContext";
import { VisualElementRenderer } from "./VisualElementRenderer";
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
  const { resolveMediaUrl, resolveMediaVariants, resolveMediaVariantUrl } = useRendererContext();

  const mediaId = element.source.kind === "media" ? element.source.mediaId : null;

  // An empty URL is treated as no source: rendering src="" makes the browser refetch the page.
  const src =
    element.source.kind === "url"
      ? (element.source.url.trim() || null)
      : mediaId === null
        ? null
        : resolveMediaUrl(mediaId);

  if (src === null) {
    // A missing or broken source renders a neutral placeholder instead of a broken-image icon.
    return <div style={{ ...imageStyle(element), backgroundColor: "#eceef2" }} role="presentation" />;
  }

  const variants = mediaId === null ? [] : (resolveMediaVariants?.(mediaId) ?? []);
  const srcSet =
    mediaId === null || resolveMediaVariantUrl === undefined
      ? ""
      : buildSrcSet(variants, (width) => resolveMediaVariantUrl(mediaId, width));

  // Widest variant is the intrinsic size for the purpose of reserving space. Without width and
  // height the browser cannot hold the slot, and everything below shifts as the image arrives.
  const largest = variants.at(-1);

  return (
    <img
      src={src}
      {...(srcSet === "" ? {} : { srcSet, sizes: IMAGE_SIZES })}
      {...(largest === undefined ? {} : { width: largest.width, height: largest.height })}
      alt={element.decorative ? "" : element.alt}
      {...(element.decorative ? { role: "presentation" } : {})}
      loading="lazy"
      decoding="async"
      style={imageStyle(element)}
    />
  );
}

/**
 * How much horizontal space an image occupies.
 *
 * Elements are full-width inside their slot, and the slot narrows with the layout. Claiming a
 * smaller share would make every screen render a blurry image; claiming a larger one would send
 * desktop bytes to phones.
 */
const IMAGE_SIZES = buildSizes(
  [
    { maxWidth: 640, value: "100vw" },
    { maxWidth: 1024, value: "50vw" },
  ],
  "33vw",
);

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
      <button type="button" style={buttonStyle(element)} disabled data-element-id={element.id}>
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
      data-element-id={element.id}
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
    ) : element.type === "container" ? (
      <ContainerRenderer element={element} />
    ) : (
      <VisualElementRenderer element={element} />
    );

  if (!positioned) return inner;

  // The positioning wrapper carries no `data-element-id`. It used to, which meant an element's id
  // appeared only in free-layout sections — every flow and stack section rendered anonymous
  // elements, and a click there could not be attributed. The id now lives on the rendered control
  // itself (see `ButtonRenderer`), where it is emitted in every layout, and putting it on the
  // wrapper as well would nest two carriers of the same id and count one click twice.
  return (
    <div style={{ ...freeGeometryStyle(element.geometry), zIndex: element.zIndex }}>{inner}</div>
  );
}
