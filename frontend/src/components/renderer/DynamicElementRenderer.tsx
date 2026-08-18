import type {
  DynamicBinding,
  DynamicElement,
  PublishablePost,
  RichTextNode,
} from "@websitebuilder/shared";

import { RichText } from "./ContentElementRenderer";
import { useRendererContext } from "./RendererContext";

/**
 * The blocks that show a post's own values.
 *
 * A template is an ordinary page except that some of its blocks are bound: they read from whichever
 * post the route is rendering rather than from anything stored on the block. That is what lets one
 * layout serve every article, and it is why these types exist as their own union rather than as a
 * flag on a text block — a renderer holding one is never uncertain which it has.
 *
 * With no record to read — the builder canvas, an index route — a bound block shows the name of the
 * field it is bound to. Rendering nothing there would leave a designer arranging invisible boxes.
 */

/** The label a bound block shows when there is no record behind it. */
function placeholderFor(binding: DynamicBinding): string {
  return binding.source === "system" ? `{${binding.field}}` : `{${binding.fieldId}}`;
}

function valueOf(
  binding: DynamicBinding,
  post: PublishablePost | undefined,
  resolve: ((binding: DynamicBinding) => string | undefined) | undefined,
): string | undefined {
  const resolved = resolve?.(binding);
  if (resolved !== undefined) return resolved;
  if (post === undefined || binding.source !== "system") return undefined;

  switch (binding.field) {
    case "title":
      return post.title;
    case "excerpt":
      return post.excerpt;
    case "cover":
      return post.coverMediaId;
    case "author":
      return post.authorName;
    case "publishedAt":
      return post.publishedAt;
    // The body is rich text, not a string, and is rendered by its own branch below.
    case "content":
    case "category":
      return undefined;
  }
}

export function DynamicElementRenderer({ element }: { element: DynamicElement }) {
  const { post, posts, resolveBinding, resolveMediaUrl } = useRendererContext();

  if (element.type === "postCollection") {
    const listed = [...(posts ?? [])].slice(0, element.query.limit);

    if (listed.length === 0) {
      return element.emptyStateText === "" ? null : <p>{element.emptyStateText}</p>;
    }

    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(auto-fit, minmax(min(${Math.round(1000 / element.columns)}px, 100%), 1fr))`,
          gap: element.gap,
        }}
      >
        {listed.map((listedPost) => (
          <PostCardFields key={listedPost.id} post={listedPost} fields={element.cardFields} />
        ))}
      </div>
    );
  }

  // The body is the one binding that is a document rather than a string.
  if (element.binding.source === "system" && element.binding.field === "content") {
    const body = (post?.content?.content ?? []) as readonly RichTextNode[];
    return body.length === 0 ? <span>{placeholderFor(element.binding)}</span> : <RichText nodes={body} />;
  }

  const value = valueOf(element.binding, post, resolveBinding);
  if (value === undefined || value === "") {
    // Named rather than blank: an empty box on a canvas tells a designer nothing about what will
    // appear there, and on a published page an absent value is simply nothing to draw.
    return post === undefined ? <span style={{ opacity: 0.5 }}>{placeholderFor(element.binding)}</span> : null;
  }

  switch (element.display) {
    case "heading":
      return <h1 style={{ margin: 0 }}>{value}</h1>;
    case "image": {
      const src = resolveMediaUrl(value);
      return src === null ? null : (
        <img src={src} alt="" decoding="async" style={{ width: "100%", height: "auto", display: "block" }} />
      );
    }
    case "date":
      return <time dateTime={value}>{value.slice(0, 10)}</time>;
    case "link":
      return <a href={value}>{value}</a>;
    case "richText":
    case "text":
      return <p style={{ margin: 0 }}>{value}</p>;
  }
}

/** One card in a list block: the fields the template chose, in the order it chose them. */
function PostCardFields({ post, fields }: { post: PublishablePost; fields: readonly DynamicBinding[] }) {
  const { resolveMediaUrl, resolveBinding } = useRendererContext();

  return (
    <article style={{ minWidth: 0 }}>
      {fields.map((binding, index) => {
        const value = valueOf(binding, post, resolveBinding);
        if (value === undefined || value === "") return null;

        const key = `${binding.source}-${index}`;
        if (binding.source === "system" && binding.field === "cover") {
          const src = resolveMediaUrl(value);
          return src === null ? null : (
            <img
              key={key}
              src={src}
              alt=""
              loading="lazy"
              decoding="async"
              style={{ width: "100%", height: "auto", display: "block", borderRadius: 8 }}
            />
          );
        }

        if (binding.source === "system" && binding.field === "title") {
          return (
            <h2 key={key} style={{ margin: "8px 0 0" }}>
              {value}
            </h2>
          );
        }

        return (
          <p key={key} style={{ margin: "4px 0 0" }}>
            {value}
          </p>
        );
      })}
    </article>
  );
}
