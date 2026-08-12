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
import { BlockIcon } from "./BlockIcon";
import { buttonStyle, containerStyle, imageStyle, isRenderable, textStyle } from "./styles";

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

  // The icon a button stores is finally rendered. It is decorative: the label beside it says the
  // same thing, and a screen reader announcing both reads it twice.
  const icon = element.icon === undefined ? null : <BlockIcon name={element.icon.name} size={16} />;
  const content = (
    <>
      {element.icon?.position === "before" && icon}
      <span>{element.text}</span>
      {element.icon?.position === "after" && icon}
    </>
  );

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
  return (
    <div style={containerStyle(element)}>
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

  // One wrapper in every layout mode, carrying the id the compiled stylesheet addresses and the
  // heatmap overlay anchors to. Placement is not inline any more: the compiler emits it, because
  // an inline `left` computed at one width is exactly what sent elements off the side of a phone.
  //
  // The z-index stays inline. It is a single authored number with no responsive behaviour, and a
  // rule per element for it would double the stylesheet to say what an attribute already says.
  return (
    <div data-element-id={element.id} style={positioned ? { zIndex: element.zIndex } : undefined}>
      {inner}
    </div>
  );
}
