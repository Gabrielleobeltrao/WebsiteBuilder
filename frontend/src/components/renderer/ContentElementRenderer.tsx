import {
  CONTACT_ICONS,
  hasTimezone,
  resolveSafeLinkHref,
  type ContentElement,
  type RichTextNode,
} from "@websitebuilder/shared";
import { Fragment, type ReactNode } from "react";

import { BlockIcon } from "./BlockIcon";
import { useRendererContext } from "./RendererContext";
import { withAppearance } from "./withAppearance";

/**
 * The blocks that carry their own meaning: prose, navigation, identity, a value, a moment.
 *
 * Everything here renders complete without JavaScript. A carousel is a scrollable row of slides, a
 * countdown shows the date it is counting to, a counter shows its number, a table of contents lists
 * its headings. The runtime makes several of them nicer; none of them needs it to be readable, and
 * that is the line this file does not cross.
 */
export function ContentElementRenderer({ element }: { element: ContentElement }) {
  return withAppearance(element, ContentElementBody({ element }));
}

function ContentElementBody({ element }: { element: ContentElement }) {
  const { resolveMediaUrl, resolvePagePath, homePath, allowHttp } = useRendererContext();
  const link = (value: unknown) =>
    resolveSafeLinkHref(value as Parameters<typeof resolveSafeLinkHref>[0], {
      resolvePagePath,
      ...(allowHttp === undefined ? {} : { allowHttp }),
    });

  switch (element.type) {
    case "richText":
      return <RichText nodes={element.content.content ?? []} />;

    case "navigationMenu": {
      const horizontal = element.orientation === "horizontal";
      return (
        <nav data-wb-nav data-wb-nav-label={element.name || "Menu"} style={{ maxWidth: "100%" }}>
          <ul
            data-wb-nav-list
            style={{
              display: "flex",
              flexDirection: horizontal ? "row" : "column",
              flexWrap: "wrap",
              gap: 16,
              listStyle: "none",
              margin: 0,
              padding: 0,
            }}
          >
            {element.items.map((item, index) => {
              const href = link(item.link);
              return (
                <li key={index}>
                  {href === null ? (
                    <span>{item.label}</span>
                  ) : (
                    <a href={href.href} {...(href.target ? { target: href.target } : {})} {...(href.rel ? { rel: href.rel } : {})}>
                      {item.label}
                    </a>
                  )}
                  {item.children !== undefined && item.children.length > 0 && (
                    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                      {item.children.map((child, childIndex) => {
                        const childHref = link(child.link);
                        return (
                          <li key={childIndex}>
                            {childHref === null ? (
                              <span>{child.label}</span>
                            ) : (
                              <a href={childHref.href}>{child.label}</a>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
      );
    }

    case "siteLogo": {
      const src = element.mediaId === "" ? null : resolveMediaUrl(element.mediaId);
      // Falls back to the site's name rather than to nothing: a header with an empty box where the
      // logo should be looks broken, and a word does the job.
      const mark = src === null ? <span>{element.fallbackText}</span> : <img src={src} alt={element.alt} style={{ maxWidth: "100%", height: "auto" }} />;
      const home = homePath ?? null;

      return element.linksHome && home !== null ? <a href={home}>{mark}</a> : <>{mark}</>;
    }

    case "testimonial": {
      const avatar = element.avatarMediaId === "" ? null : resolveMediaUrl(element.avatarMediaId);
      return (
        // A quotation, marked as one. A paragraph in italics is a style; this is the meaning.
        <figure style={{ margin: 0 }}>
          <blockquote style={{ margin: 0 }}>{element.quote}</blockquote>
          <figcaption style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            {avatar !== null && <img src={avatar} alt="" style={{ width: 40, height: 40, borderRadius: "50%" }} />}
            <span>
              {element.personName}
              {element.personRole !== "" && <span>, {element.personRole}</span>}
            </span>
            {element.rating !== undefined && (
              <span aria-label={`${element.rating}/5`} style={{ display: "inline-flex" }}>
                {Array.from({ length: element.rating }, (_, index) => (
                  <BlockIcon key={index} name="star" size={14} />
                ))}
              </span>
            )}
          </figcaption>
        </figure>
      );
    }

    case "carousel":
      return (
        // A scroll container, so every slide is reachable by swipe, wheel and keyboard before any
        // script runs. The runtime adds arrows and dots on top of exactly this.
        <div
          data-wb-carousel
          {...(element.autoplaySeconds > 0 ? { "data-wb-carousel-autoplay": String(element.autoplaySeconds) } : {})}
          style={{ display: "flex", overflowX: "auto", scrollSnapType: "x mandatory", gap: 16, maxWidth: "100%" }}
        >
          {element.slides.map((slide, index) => {
            const src = slide.mediaId === "" ? null : resolveMediaUrl(slide.mediaId);
            const href = link(slide.link);
            return (
              <section key={index} style={{ flex: "0 0 100%", scrollSnapAlign: "start", minWidth: 0 }}>
                {src !== null && <img src={src} alt={slide.alt} loading={index === 0 ? "eager" : "lazy"} style={{ width: "100%", display: "block" }} />}
                {slide.heading !== "" && <h3>{slide.heading}</h3>}
                {slide.text !== "" && <p>{slide.text}</p>}
                {href !== null && slide.ctaLabel !== "" && (
                  <a href={href.href} {...(href.target ? { target: href.target } : {})} {...(href.rel ? { rel: href.rel } : {})}>
                    {slide.ctaLabel}
                  </a>
                )}
              </section>
            );
          })}
        </div>
      );

    case "contactInfo":
      return (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
          {element.items.map((item, index) => (
            <li key={index} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <BlockIcon name={CONTACT_ICONS[item.kind]} size={element.iconSize} />
              <span>
                {item.label !== "" && <span>{item.label}: </span>}
                <ContactValue kind={item.kind} value={item.value} />
              </span>
            </li>
          ))}
        </ul>
      );

    case "counter": {
      const formatted = `${element.prefix}${element.value}${element.suffix}`;
      if (element.display === "bar") {
        const max = element.max ?? 100;
        const percent = Math.max(0, Math.min(100, (element.value / max) * 100));
        return (
          // A native progress element: it announces its own value, and needs no script to show it.
          <div>
            <progress value={element.value} max={max} style={{ width: "100%" }}>
              {formatted}
            </progress>
            <span>{element.label !== "" ? `${element.label}: ${formatted}` : formatted}</span>
            <span hidden>{percent}</span>
          </div>
        );
      }

      return (
        <p>
          {/* The final value is in the markup. The runtime only animates towards a number a visitor
              can already read, and skips even that when they asked for less motion. */}
          <span data-wb-count-to={element.value}>{formatted}</span>
          {element.label !== "" && <span> {element.label}</span>}
        </p>
      );
    }

    case "countdown": {
      const valid = hasTimezone(element.target);
      return (
        <p
          {...(valid ? { "data-wb-countdown": element.target, "data-wb-countdown-expired": element.expiredText } : {})}
        >
          {/* Rendered server-side as an absolute date, so a visitor with no JavaScript — or a
              browser whose clock is wrong — still reads something true. */}
          <time dateTime={valid ? element.target : undefined} data-wb-countdown-value>
            {valid ? new Date(element.target).toISOString().replace("T", " ").slice(0, 16) : element.expiredText}
          </time>
        </p>
      );
    }

    case "tableOfContents":
      // The entries are filled in by whoever renders the page around it, because the headings are
      // not this block's own content. Empty is the honest state until then.
      return (
        <nav data-wb-toc aria-label={element.title || "Contents"}>
          {element.title !== "" && <h2>{element.title}</h2>}
          <ol data-wb-toc-list data-min-level={element.minLevel} data-max-level={element.maxLevel} />
        </nav>
      );
  }
}

/** A contact detail becomes the action it implies: a call, an email, a message. */
function ContactValue({ kind, value }: { kind: string; value: string }) {
  const trimmed = value.trim();
  if (trimmed === "") return null;

  if (kind === "email") return <a href={`mailto:${encodeURIComponent(trimmed)}`}>{trimmed}</a>;
  if (kind === "phone") return <a href={`tel:${trimmed.replace(/[^\d+]/g, "")}`}>{trimmed}</a>;
  if (kind === "whatsapp") {
    const digits = trimmed.replace(/\D/g, "");
    return digits === "" ? <span>{trimmed}</span> : <a href={`https://wa.me/${digits}`} rel="noreferrer noopener" target="_blank">{trimmed}</a>;
  }
  return <span>{trimmed}</span>;
}

/**
 * Rich text, rendered node by node.
 *
 * Never `dangerouslySetInnerHTML`. The document is a validated tree from a closed vocabulary, and
 * this walks it — which is what makes prose from a customer safe by construction rather than by
 * sanitising a string somebody hopes was cleaned.
 */
/**
 * Validated rich text, walked into elements.
 *
 * Exported because the blog renders article bodies through the same walker. A second implementation
 * would be a second place for the allowlist to drift, on the one surface where drifting means
 * stored markup reaching a stranger's browser.
 */
export function RichText({ nodes }: { nodes: readonly RichTextNode[] }): ReactNode {
  return (
    <>
      {nodes.map((node, index) => (
        <Fragment key={index}>{renderNode(node)}</Fragment>
      ))}
    </>
  );
}

function renderNode(node: RichTextNode): ReactNode {
  const children = node.content === undefined ? null : <RichText nodes={node.content} />;
  const text = (node as { text?: string }).text;

  switch (node.type) {
    case "text": {
      const marks = node.marks ?? [];
      let rendered: ReactNode = text ?? "";
      for (const mark of marks) {
        if (mark.type === "bold") rendered = <strong>{rendered}</strong>;
        else if (mark.type === "italic") rendered = <em>{rendered}</em>;
        else if (mark.type === "code") rendered = <code>{rendered}</code>;
        else if (mark.type === "link") {
          const href = (mark as { attrs?: { href?: string } }).attrs?.href ?? "";
          // Only https, mailto and tel reach a visitor. The editor's own allowlist says the same
          // thing; this is the second place that has to agree, because output is what matters.
          rendered = /^(https:|mailto:|tel:)/.test(href) ? <a href={href}>{rendered}</a> : rendered;
        }
      }
      return rendered;
    }
    case "paragraph":
      return <p>{children}</p>;
    case "heading": {
      const level = Math.min(6, Math.max(1, (node as { attrs?: { level?: number } }).attrs?.level ?? 2));
      const Tag = `h${level}` as "h2";
      return <Tag>{children}</Tag>;
    }
    case "bulletList":
      return <ul>{children}</ul>;
    case "orderedList":
      return <ol>{children}</ol>;
    case "listItem":
      return <li>{children}</li>;
    case "blockquote":
      return <blockquote>{children}</blockquote>;
    case "horizontalRule":
      return <hr />;
    case "hardBreak":
      return <br />;
    default:
      // An unknown node renders its children rather than nothing: prose that loses a paragraph
      // because of one unrecognised wrapper is worse than prose that loses its wrapper.
      return children;
  }
}
