import {
  applyCmsQuery,
  cmsItemPath,
  type CmsCardField,
  type CmsCollectionElement,
  type QueryableItem,
} from "@websitebuilder/shared";
import { useState } from "react";

import { useRendererContext } from "./RendererContext";

/**
 * Renders a CMS list.
 *
 * One card sub-layout is reused for every item, and every value is read by immutable field id. That
 * is what makes publishing a matching item enough to add it to every configured listing without
 * anyone editing those pages.
 *
 * A card whose field no longer exists renders nothing for that field rather than the string
 * "undefined": a visibly empty slot is a signal, an invented value is a lie.
 */
export function CmsCollectionRenderer({
  element,
  items,
  collectionSlug,
  includeDrafts = false,
}: {
  element: CmsCollectionElement;
  items: readonly QueryableItem[];
  collectionSlug: string;
  /** The editor previews with real drafts; published output never does. */
  includeDrafts?: boolean;
}) {
  const [page, setPage] = useState(1);

  // Load-more, not page-replacement: the control says "show more", so earlier items stay. Each page
  // is resolved through the same query, so the accumulated list is exactly what paging would have
  // produced one page at a time.
  const pages = Array.from({ length: page }, (_, index) =>
    applyCmsQuery(element.query, items, { page: index + 1, includeDrafts }),
  );
  const shown = pages.flatMap((entry) => entry.items);
  const result = { total: pages[0]?.total ?? 0, hasMore: pages.at(-1)?.hasMore ?? false };

  if (result.total === 0) {
    return (
      <p data-cms-empty className="text-sm text-ink-600">
        {element.emptyStateText}
      </p>
    );
  }

  return (
    <div>
      <ul
        style={
          element.layout === "grid"
            ? {
                display: "grid",
                gridTemplateColumns: `repeat(${element.columns}, minmax(0, 1fr))`,
                gap: element.gap,
              }
            : { display: "flex", flexDirection: "column", gap: element.gap }
        }
      >
        {shown.map((item) => (
          <li key={item.id} data-cms-item={item.id} style={{ minWidth: 0 }}>
            <Card element={element} item={item} collectionSlug={collectionSlug} />
          </li>
        ))}
      </ul>

      {element.query.paginate && result.hasMore && (
        <button
          type="button"
          onClick={() => setPage((current) => current + 1)}
          style={{ marginTop: element.gap }}
          className="rounded-lg px-4 py-2 text-sm ring-1 ring-ink-300"
        >
          {/* Site content, not interface copy: the published site's language is not the language
              of the person editing it, so this comes from the document. */}
          {element.loadMoreText}
        </button>
      )}
    </div>
  );
}

function Card({
  element,
  item,
  collectionSlug,
}: {
  element: CmsCollectionElement;
  item: QueryableItem;
  collectionSlug: string;
}) {
  const body = (
    <div>
      {element.cardFields.map((card) => (
        <CardField key={card.fieldId} card={card} value={item.values[card.fieldId]} />
      ))}
    </div>
  );

  if (!element.linkToDetail) return body;

  return (
    <a href={cmsItemPath(collectionSlug, item.slug)} style={{ display: "block", color: "inherit" }}>
      {body}
    </a>
  );
}

function CardField({ card, value }: { card: CmsCardField; value: unknown }) {
  const { resolveMediaUrl } = useRendererContext();

  // A field the schema no longer declares, or one an item never filled, renders nothing.
  if (value === undefined || value === null || value === "") return null;

  if (card.display === "image") {
    const src = typeof value === "string" ? resolveMediaUrl(value) : null;
    if (src === null) return null;
    return <img src={src} alt="" loading="lazy" decoding="async" style={{ width: "100%", display: "block" }} />;
  }

  if (card.display === "link") {
    // Only the two schemes a site link may use. Anything else renders as text rather than as a
    // link, so a stored `javascript:` value cannot become clickable.
    const href = typeof value === "string" && /^https?:\/\//i.test(value) ? value : null;
    return href === null ? <span>{String(value)}</span> : <a href={href}>{href}</a>;
  }

  if (card.display === "heading") return <h3>{String(value)}</h3>;

  if (card.display === "date") {
    const parsed = typeof value === "string" ? new Date(value) : null;
    const valid = parsed !== null && !Number.isNaN(parsed.getTime());
    return <time dateTime={valid ? parsed.toISOString() : undefined}>{String(value)}</time>;
  }

  // richText arrives as structured data elsewhere; on a card it is flattened to text rather than
  // injected as markup.
  return <p>{typeof value === "object" ? "" : String(value)}</p>;
}
