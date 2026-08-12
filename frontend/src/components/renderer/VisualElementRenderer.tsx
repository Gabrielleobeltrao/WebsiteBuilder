import {
  serializeFocalPoint,
  type VisualElement,
} from "@websitebuilder/shared";

import { useRendererContext } from "./RendererContext";

/**
 * The visual elements, rendered from the document.
 *
 * The interactive ones live in `InteractiveElements` and are not reached from here: that module
 * uses browser APIs, and this file is on the path the server renderer compiles. Their static
 * markup is produced here so a published page has real content before any script runs, and the
 * browser upgrades them in place.
 */
export function VisualElementRenderer({ element }: { element: VisualElement }) {
  const { resolveMediaUrl } = useRendererContext();

  switch (element.type) {
    case "form":
      // Rendered by the form block, which needs the definition it references and therefore the
      // module's own component. Reaching this case at all means the dispatcher above did not.
      return null;
    case "divider":
      return (
        <hr
          style={{
            border: 0,
            borderTop: `${element.thickness}px ${element.style} ${element.color}`,
            margin: 0,
          }}
        />
      );

    case "spacer":
      // Presentational by definition, so it is hidden from assistive technology rather than
      // announced as an empty region.
      return <div aria-hidden style={{ width: "100%", height: "100%" }} />;

    case "icon":
      return (
        <span aria-hidden style={{ fontSize: element.size, color: element.color, lineHeight: 1 }}>
          ●
        </span>
      );

    case "iconList":
      return (
        <ul style={{ display: "flex", flexDirection: "column", gap: element.gap, listStyle: "none", padding: 0 }}>
          {element.items.map((item, index) => (
            <li key={index} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span aria-hidden style={{ fontSize: element.iconSize }}>
                ●
              </span>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      );

    case "breadcrumbs":
      // The trail itself is resolved by the page that renders it; this is the landmark it lives in.
      // Its name comes from the document because a visitor hears it in the site's language.
      return <nav aria-label={element.label} data-separator={element.separator} />;

    case "downloadButton": {
      const href = resolveMediaUrl(element.mediaId);
      if (href === null) return null;
      return (
        <a href={href} download style={{ display: "inline-block" }}>
          {element.label}
        </a>
      );
    }

    case "gallery":
      // Static markup: every image is present and readable without scripting. The browser replaces
      // this with the lightbox version, which needs a real dialog and therefore a DOM.
      return (
        <ul
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${element.columns}, minmax(0, 1fr))`,
            gap: element.gap,
            listStyle: "none",
            padding: 0,
          }}
        >
          {element.mediaIds.map((mediaId) => {
            const src = resolveMediaUrl(mediaId);
            return src === null ? null : (
              <li key={mediaId} style={{ minWidth: 0 }}>
                <img
                  src={src}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  style={{ width: "100%", display: "block", objectPosition: serializeFocalPoint(undefined) }}
                />
              </li>
            );
          })}
        </ul>
      );

    case "table":
      return (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          {element.caption !== "" && <caption>{element.caption}</caption>}
          {element.hasHeaderRow && (
            <thead>
              <tr>
                {element.headers.map((header, index) => (
                  <th key={index} scope="col">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {element.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );

    case "pricingTable":
      return (
        <ul style={{ display: "flex", gap: 16, listStyle: "none", padding: 0, flexWrap: "wrap" }}>
          {element.plans.map((plan, index) => (
            <li key={index} style={{ flex: "1 1 220px", minWidth: 0 }}>
              <h3>{plan.name}</h3>
              <p>
                {plan.price}
                <span> {plan.period}</span>
              </p>
              <ul>
                {plan.features.map((feature, position) => (
                  <li key={position}>{feature}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      );

    case "socialLinks":
      return (
        <ul style={{ display: "flex", gap: element.gap, listStyle: "none", padding: 0 }}>
          {element.items.map((item) => (
            <li key={item.network}>
              {/* Named, so it is not announced as a bare bullet, and opened without handing over
                  the opener. */}
              <a href={item.url} rel="noreferrer noopener" target="_blank" aria-label={item.network}>
                <span aria-hidden style={{ fontSize: element.iconSize }}>
                  ●
                </span>
              </a>
            </li>
          ))}
        </ul>
      );

    case "video":
      return <div data-video-provider={element.provider} data-video-id={element.videoId} aria-label={element.title} />;

    case "accordion":
      // `<details>` needs no script, so the published page is fully usable as served.
      return (
        <div>
          {element.items.map((item, index) => (
            <details key={index}>
              <summary style={{ minHeight: 44, display: "flex", alignItems: "center" }}>{item.question}</summary>
              <div>{item.answer}</div>
            </details>
          ))}
        </div>
      );

    case "tabs":
      // Without scripting every panel is visible rather than none: content a visitor cannot reach
      // is worse than content shown all at once.
      return (
        <div>
          {element.items.map((item, index) => (
            <section key={index} aria-label={item.label}>
              <h3>{item.label}</h3>
              <div>{item.content}</div>
            </section>
          ))}
        </div>
      );

    case "announcementBar":
      return (
        <div
          role="region"
          aria-label={element.text}
          style={{ backgroundColor: element.backgroundColor, color: element.textColor, padding: "8px 12px" }}
        >
          {element.text}
        </div>
      );
  }

  // Unreachable while every member of the union is handled above. When a new block is added and
  // this stops compiling, that is the point: the block has no rendering yet.
  return assertHandled(element);
}

function assertHandled(element: never): never {
  throw new Error(`No renderer for element type: ${(element as { type?: string }).type ?? "unknown"}`);
}
