import {
  resolveSafeLinkHref,
  serializeFocalPoint,
  videoEmbedUrl,
  VIDEO_IFRAME_ALLOW,
  type VisualElement,
} from "@websitebuilder/shared";

import { BlockIcon } from "./BlockIcon";
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
  const { resolveMediaUrl, resolvePagePath, resolveTrail, allowHttp } = useRendererContext();

  // Resolved before the switch, because hooks and helpers cannot be called inside one branch only.
  const iconHref =
    element.type === "icon"
      ? resolveSafeLinkHref(element.link, { resolvePagePath, ...(allowHttp === undefined ? {} : { allowHttp }) })
      : null;
  const iconLabel = element.type === "icon" && iconHref !== null ? element.name || element.icon : undefined;

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
            // Never wider than what holds it. A rule is decoration, and decoration that pushes the
            // page sideways on a phone is worse than no rule.
            width: "100%",
            maxWidth: "100%",
          }}
        />
      );

    case "spacer":
      // Presentational by definition, so it is hidden from assistive technology rather than
      // announced as an empty region.
      return <div aria-hidden style={{ width: "100%", height: "100%" }} />;

    case "icon": {
      const drawn = <BlockIcon name={element.icon} size={element.size} color={element.color} label={iconLabel} />;
      // An icon that links needs a name: on its own it is the only thing announced, and "graphic"
      // tells nobody where it goes.
      return iconHref === null ? drawn : (
        <a href={iconHref.href} {...(iconHref.target ? { target: iconHref.target } : {})} {...(iconHref.rel ? { rel: iconHref.rel } : {})}>
          {drawn}
        </a>
      );
    }

    case "iconList":
      return (
        <ul style={{ display: "flex", flexDirection: "column", gap: element.gap, listStyle: "none", padding: 0 }}>
          {element.items.map((item, index) => (
            <li key={index} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <BlockIcon name={item.icon} size={element.iconSize} />
              <IconListLabel item={item} />
            </li>
          ))}
        </ul>
      );

    case "breadcrumbs": {
      // The trail is resolved by whoever knows where this page sits. Its name comes from the
      // document because a visitor hears it in the site's language, not the editor's.
      const trail = resolveTrail?.() ?? [];
      if (trail.length === 0) return <nav aria-label={element.label} data-separator={element.separator} />;

      const separator = element.separator === "slash" ? "/" : element.separator === "dot" ? "·" : "›";

      return (
        <nav aria-label={element.label} data-separator={element.separator}>
          <ol style={{ display: "flex", flexWrap: "wrap", gap: 8, listStyle: "none", margin: 0, padding: 0 }}>
            {trail.map((step, index) => (
              <li key={`${step.label}-${index}`} style={{ display: "flex", gap: 8 }}>
                {index > 0 && <span aria-hidden>{separator}</span>}
                {step.href === null || index === trail.length - 1 ? (
                  // The last step is where the visitor already is: a link to here is a link to
                  // nowhere, and `aria-current` is what says so.
                  <span {...(index === trail.length - 1 ? { "aria-current": "page" as const } : {})}>{step.label}</span>
                ) : (
                  <a href={step.href}>{step.label}</a>
                )}
              </li>
            ))}
          </ol>
        </nav>
      );
    }

    case "downloadButton": {
      // An unconfigured button renders as disabled rather than vanishing: a control that is simply
      // absent from the page looks like a bug to the person who placed it.
      const href = element.mediaId === "" ? null : resolveMediaUrl(element.mediaId);
      if (href === null) {
        return (
          <button type="button" disabled style={{ display: "inline-block" }}>
            {element.label}
          </button>
        );
      }

      return (
        <a href={href} download style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <BlockIcon name="download" size={16} />
          {element.label}
        </a>
      );
    }

    case "gallery":
      // Static markup: every image is present and readable without scripting. The browser replaces
      // this with the lightbox version, which needs a real dialog and therefore a DOM.
      return (
        <ul
          {...(element.lightbox ? { "data-wb-lightbox": "" } : {})}
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${element.columns}, minmax(0, 1fr))`,
            gap: element.gap,
            listStyle: "none",
            padding: 0,
          }}
        >
          {element.items.map((item, index) => {
            const src = item.mediaId === "" ? null : resolveMediaUrl(item.mediaId);
            return src === null ? null : (
              <li key={`${item.mediaId}-${index}`} style={{ minWidth: 0 }}>
                <figure style={{ margin: 0 }}>
                  <img
                    src={src}
                    // Each image carries its own text. A gallery that describes none of its images
                    // is a wall of "image" to anyone who cannot see it.
                    alt={item.decorative ? "" : item.alt}
                    {...(item.decorative ? { role: "presentation" } : {})}
                    loading="lazy"
                    decoding="async"
                    style={{
                      width: "100%",
                      display: "block",
                      objectPosition: serializeFocalPoint(undefined),
                      ...(element.aspectRatio === undefined
                        ? {}
                        : { aspectRatio: element.aspectRatio, objectFit: "cover" as const }),
                    }}
                  />
                  {item.caption !== "" && (
                    <figcaption style={{ fontSize: "0.875em", marginTop: 4 }}>{item.caption}</figcaption>
                  )}
                </figure>
              </li>
            );
          })}
        </ul>
      );

    case "table":
      return (
        // The scroll lives here rather than on the page: a table with six columns on a phone is
        // going to be wider than the screen, and the choice is between scrolling the table and
        // scrolling everything.
        <div style={{ overflowX: "auto", maxWidth: "100%" }}>
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
        </div>
      );

    case "pricingTable":
      // A wrapping row with a per-plan floor: plans sit side by side while they fit and stack when
      // they do not, with no media query and no width the document had to guess.
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
      // Each network keeps its own mark rather than a shared arrow: a row of identical glyphs tells
      // a visitor nothing about where each one goes.
      return (
        <ul style={{ display: "flex", gap: element.gap, listStyle: "none", padding: 0 }}>
          {element.items.map((item) => (
            <li key={item.network}>
              {/* Named, so it is not announced as a bare bullet, and opened without handing over
                  the opener. */}
              <a href={item.url} rel="noreferrer noopener" target="_blank" aria-label={item.network}>
                <BlockIcon name={SOCIAL_ICONS[item.network] ?? "external-link"} size={element.iconSize} />
              </a>
            </li>
          ))}
        </ul>
      );

    case "video":
      // An unconfigured block is a visible placeholder rather than an empty frame: a page that says
      // nothing is indistinguishable from one that failed to load.
      if (element.videoId.trim() === "") {
        return <div role="img" aria-label={element.title} style={{ width: "100%", height: "100%", backgroundColor: "#eceef2" }} />;
      }

      return (
        <iframe
          // The URL is built from the provider and an id-shaped string; no document value is ever
          // loaded as a frame source.
          src={videoEmbedUrl(element)}
          title={element.title}
          allow={VIDEO_IFRAME_ALLOW}
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
          style={{ width: "100%", height: "100%", border: 0 }}
        />
      );

    case "accordion":
      // `<details>` needs no script, so the published page is fully usable as served.
      return (
        <div>
          {element.items.map((item, index) => (
            // `name` makes a group of details mutually exclusive in the browser itself, so
            // "one open at a time" needs no script and works on the page as served.
            <details key={index} {...(element.allowMultiple ? {} : { name: `accordion-${element.id}` })}>
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
        // The attributes are the contract with the runtime: it finds the panels, borrows each
        // heading as a tab label, and hides all but one. Without it every panel stays visible and
        // readable, which is the fallback that makes the upgrade optional.
        <div data-wb-tabs id={`tabs-${element.id}`}>
          {element.items.map((item, index) => (
            <section key={index} aria-label={item.label} data-wb-tab-panel>
              <h3 data-wb-tab-label>{item.label}</h3>
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
          // Keyed by the text: an announcement a visitor dismissed stays dismissed until it changes,
          // and a new announcement is a new thing to have missed.
          {...(element.dismissible ? { "data-wb-dismiss": element.id } : {})}
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

/**
 * A mark per network, from the same closed icon set.
 *
 * Not a brand logo: shipping trademarked marks in a builder's public output is somebody else's
 * licensing decision, and a recognisable neutral glyph beside a named link does the job.
 */
const SOCIAL_ICONS: Record<string, string> = {
  instagram: "heart",
  facebook: "info",
  linkedin: "info",
  youtube: "play",
  tiktok: "play",
  whatsapp: "phone",
  x: "close",
  github: "external-link",
};

/** An icon-list row, which may be a link. */
function IconListLabel({ item }: { item: { text: string; link?: unknown } }) {
  const { resolvePagePath, allowHttp } = useRendererContext();
  const link =
    item.link === undefined
      ? null
      : resolveSafeLinkHref(item.link as Parameters<typeof resolveSafeLinkHref>[0], {
          resolvePagePath,
          ...(allowHttp === undefined ? {} : { allowHttp }),
        });

  if (link === null) return <span>{item.text}</span>;
  return (
    <a href={link.href} {...(link.target ? { target: link.target } : {})} {...(link.rel ? { rel: link.rel } : {})}>
      {item.text}
    </a>
  );
}

function assertHandled(element: never): never {
  throw new Error(`No renderer for element type: ${(element as { type?: string }).type ?? "unknown"}`);
}
