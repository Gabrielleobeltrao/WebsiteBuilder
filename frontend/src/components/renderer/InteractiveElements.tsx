import {
  videoEmbedUrl,
  VIDEO_IFRAME_ALLOW,
  type AccordionElement,
  type SocialLinksElement,
  type TableElement,
  type TabsElement,
  type VideoElement,
} from "@websitebuilder/shared";
import { useEffect, useId, useRef, useState } from "react";

/**
 * Interactive published elements.
 *
 * Each is built on the native element that already has the behaviour — `<details>`, real buttons,
 * a real `<dialog>` — rather than on a div with a click handler. That is what makes the keyboard
 * work, the screen reader announce state, and the focus land somewhere sensible without any of it
 * being reimplemented per element and forgotten in one of them.
 *
 * State is never communicated by colour alone: every control that toggles carries `aria-expanded`
 * or `aria-selected`, and every visual change is accompanied by that attribute.
 */
export function AccordionRenderer({ element }: { element: AccordionElement }) {
  // `<details>` gives keyboard operation, the expanded state and find-in-page for free. `name`
  // makes a group exclusive, which is the platform's own single-open accordion.
  const groupName = useId();

  return (
    <div>
      {element.items.map((item, index) => (
        <details key={index} {...(element.allowMultiple ? {} : { name: groupName })}>
          <summary style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center" }}>
            {item.question}
          </summary>
          <div>{item.answer}</div>
        </details>
      ))}
    </div>
  );
}

/**
 * Tabs with the ARIA pattern the specification describes: arrow keys move between tabs, Home and
 * End jump to the ends, and only the active tab is in the tab order so Tab moves past the group
 * rather than through every tab in it.
 */
export function TabsRenderer({ element }: { element: TabsElement }) {
  const [active, setActive] = useState(0);
  const baseId = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const move = (next: number) => {
    const index = (next + element.items.length) % element.items.length;
    setActive(index);
    refs.current[index]?.focus();
  };

  return (
    <div>
      <div role="tablist">
        {element.items.map((item, index) => (
          <button
            key={index}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${index}`}
            aria-selected={index === active}
            aria-controls={`${baseId}-panel-${index}`}
            tabIndex={index === active ? 0 : -1}
            onClick={() => setActive(index)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") move(index + 1);
              if (event.key === "ArrowLeft") move(index - 1);
              if (event.key === "Home") move(0);
              if (event.key === "End") move(element.items.length - 1);
            }}
            style={{ minHeight: 44, padding: "0 12px" }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {element.items.map((item, index) => (
        <div
          key={index}
          role="tabpanel"
          id={`${baseId}-panel-${index}`}
          aria-labelledby={`${baseId}-tab-${index}`}
          hidden={index !== active}
          tabIndex={0}
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}

/**
 * A lightbox on the native `<dialog>`, which brings the focus trap, the Escape key and the
 * inert background with it. Focus returns to the thumbnail that opened it, so a keyboard visitor
 * does not land back at the top of the page.
 */
export function LightboxRenderer({
  images,
  columns,
  gap,
}: {
  images: ReadonlyArray<{ id: string; src: string; alt: string }>;
  columns: number;
  gap: number;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (open === null) dialog.close();
    else if (!dialog.open) dialog.showModal();
  }, [open]);

  const close = () => {
    setOpen(null);
    openerRef.current?.focus();
  };

  return (
    <>
      <ul style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap }}>
        {images.map((image, index) => (
          <li key={image.id} style={{ minWidth: 0 }}>
            <button
              type="button"
              onClick={(event) => {
                openerRef.current = event.currentTarget;
                setOpen(index);
              }}
              style={{ display: "block", width: "100%", padding: 0, border: 0, background: "none", cursor: "zoom-in" }}
            >
              <img src={image.src} alt={image.alt} loading="lazy" decoding="async" style={{ width: "100%", display: "block" }} />
            </button>
          </li>
        ))}
      </ul>

      <dialog ref={dialogRef} onClose={close} onCancel={close} style={{ maxWidth: "90vw", maxHeight: "90vh" }}>
        {open !== null && (
          <>
            <img src={images[open]?.src} alt={images[open]?.alt ?? ""} style={{ maxWidth: "100%", display: "block" }} />
            <button type="button" onClick={close} style={{ minHeight: 44, minWidth: 44 }}>
              ×
            </button>
          </>
        )}
      </dialog>
    </>
  );
}

/**
 * A dismissible announcement.
 *
 * Dismissal is remembered for the session only. Remembering it forever would need storage a visitor
 * did not consent to, and an announcement worth showing again next week is not worth suppressing
 * permanently.
 */
export function AnnouncementBarRenderer({
  text,
  href,
  backgroundColor,
  textColor,
  dismissible,
  dismissLabel,
  storageKey,
}: {
  text: string;
  href: string | null;
  backgroundColor: string;
  textColor: string;
  dismissible: boolean;
  dismissLabel: string;
  storageKey: string;
}) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return globalThis.sessionStorage?.getItem(storageKey) === "1";
    } catch {
      // Storage can be unavailable or blocked. Showing the bar is the safe failure.
      return false;
    }
  });

  if (dismissed) return null;

  return (
    <div role="region" aria-label={text} style={{ backgroundColor, color: textColor, padding: "8px 12px" }}>
      {href === null ? <span>{text}</span> : <a href={href} style={{ color: "inherit" }}>{text}</a>}

      {dismissible && (
        <button
          type="button"
          aria-label={dismissLabel}
          onClick={() => {
            setDismissed(true);
            try {
              globalThis.sessionStorage?.setItem(storageKey, "1");
            } catch {
              // Nothing to do: the bar is already hidden for this view.
            }
          }}
          style={{ minHeight: 44, minWidth: 44, marginLeft: 12 }}
        >
          ×
        </button>
      )}
    </div>
  );
}

/** A video in an iframe whose URL this code built, with a title so it is not "unlabelled frame". */
export function VideoRenderer({ element }: { element: VideoElement }) {
  return (
    <iframe
      src={videoEmbedUrl(element)}
      title={element.title}
      allow={VIDEO_IFRAME_ALLOW}
      referrerPolicy="strict-origin-when-cross-origin"
      loading="lazy"
      style={{ width: "100%", aspectRatio: "16 / 9", border: 0 }}
    />
  );
}

/** A real table: a caption, a header row and scope, so it can be navigated rather than only seen. */
export function TableRenderer({ element }: { element: TableElement }) {
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
}

/** Social links carry the network name as their accessible name, not only an icon. */
export function SocialLinksRenderer({ element }: { element: SocialLinksElement }) {
  return (
    <ul style={{ display: "flex", gap: element.gap, listStyle: "none", padding: 0 }}>
      {element.items.map((item) => (
        <li key={item.network}>
          <a
            href={item.url}
            rel="noreferrer noopener"
            target="_blank"
            aria-label={item.network}
            style={{ display: "inline-flex", minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" }}
          >
            <span aria-hidden style={{ fontSize: element.iconSize }}>
              ●
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
