import {
  blogFormatOf,
  BLOG_FORMAT_COLUMNS,
  BLOG_FORMAT_HAS_LEAD,
  postPath,
  type BlogSettings,
  type BuilderPage,
  type PublishablePost,
  type RichTextNode,
} from "@websitebuilder/shared";
import type { CSSProperties } from "react";

import { RichText } from "./ContentElementRenderer";
import { ProjectPageRenderer } from "./ProjectPageRenderer";
import { useRendererContext } from "./RendererContext";

/**
 * A site's blog, on the two routes it publishes.
 *
 * Both are the same shape: the template page the designer owns, and beneath it the part only the
 * server can supply — the list of posts, or one article. The template is where a site puts its
 * heading, its spacing and anything else around its writing; nothing here invents any of that.
 *
 * The format decides how much of each post the index shows and how many fit across. It is a closed
 * set on purpose: those are the only two questions an index has, and everything past them is a page
 * somebody should be designing rather than configuring.
 */
/**
 * Whether a template has anything on it.
 *
 * Activating a blog seeds both templates from `createPage`, which comes with one section 480px tall
 * and nothing in it. Rendered above every article and every index, that is half a screen of blank
 * space before the first word — which reads as a blog that is not working rather than as a template
 * nobody has filled in yet.
 *
 * Checked at display time rather than fixed in the seed, because the templates already out there
 * carry that section and no migration is going to visit them.
 */
function hasContent(template: BuilderPage | undefined): template is BuilderPage {
  return template !== undefined && template.sections.some((section) => section.elements.length > 0);
}

export function BlogIndexRenderer({
  template,
  settings,
  posts,
}: {
  template?: BuilderPage;
  settings: BlogSettings;
  posts: readonly PublishablePost[];
}) {
  const format = blogFormatOf(settings);
  const columns = BLOG_FORMAT_COLUMNS[format];
  const lead = BLOG_FORMAT_HAS_LEAD[format] ? posts[0] : undefined;
  const rest = lead === undefined ? posts : posts.slice(1);

  return (
    <div>
      {hasContent(template) && <ProjectPageRenderer page={template} />}

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px", boxSizing: "border-box" }}>
        {lead !== undefined && <PostCard post={lead} settings={settings} lead />}

        {/* `auto-fit` with a `min()` floor rather than a media query: true at every width, including
            the ones nobody tested, and it collapses to one column on a phone by itself. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(auto-fit, minmax(min(${Math.round(1000 / columns)}px, 100%), 1fr))`,
            gap: 24,
            marginTop: lead === undefined ? 0 : 24,
          }}
        >
          {rest.map((post) => (
            <PostCard key={post.id} post={post} settings={settings} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PostCard({ post, settings, lead = false }: { post: PublishablePost; settings: BlogSettings; lead?: boolean }) {
  const { resolveMediaUrl } = useRendererContext();
  const cover = post.coverMediaId === undefined ? null : resolveMediaUrl(post.coverMediaId);
  const href = postPath(settings.basePath, post.slug);

  const heading: CSSProperties = { margin: "8px 0 0", fontSize: lead ? "1.75em" : "1.15em" };

  return (
    <article style={{ minWidth: 0 }}>
      <a href={href} style={{ color: "inherit", textDecoration: "none" }}>
        {cover !== null && (
          <img
            src={cover}
            alt=""
            loading="lazy"
            decoding="async"
            style={{ width: "100%", maxWidth: "100%", height: "auto", display: "block", borderRadius: 8 }}
          />
        )}
        <h2 style={heading}>{post.title}</h2>
      </a>
      {post.publishedAt !== undefined && (
        <p style={{ margin: "4px 0 0", fontSize: "0.85em", opacity: 0.7 }}>
          <time dateTime={post.publishedAt}>{post.publishedAt.slice(0, 10)}</time>
        </p>
      )}
      {post.excerpt !== undefined && post.excerpt.trim() !== "" && (
        <p style={{ margin: "8px 0 0" }}>{post.excerpt}</p>
      )}
    </article>
  );
}

/**
 * One article.
 *
 * The body is walked into elements by the same function the rich-text block uses. It is never
 * inserted as markup: the document was validated on the way in, and rendering it as HTML would
 * still mean trusting stored data at display time.
 */
export function BlogPostRenderer({ template, post }: { template?: BuilderPage; post: PublishablePost }) {
  const { resolveMediaUrl } = useRendererContext();
  const cover = post.coverMediaId === undefined ? null : resolveMediaUrl(post.coverMediaId);
  const body = (post.content?.content ?? []) as readonly RichTextNode[];

  return (
    <div>
      {hasContent(template) && <ProjectPageRenderer page={template} />}

      <article style={{ maxWidth: 720, margin: "0 auto", padding: "24px 20px", boxSizing: "border-box" }}>
        <h1 style={{ margin: 0 }}>{post.title}</h1>

        {(post.authorName !== undefined || post.publishedAt !== undefined) && (
          <p style={{ margin: "8px 0 0", fontSize: "0.85em", opacity: 0.7 }}>
            {post.authorName}
            {post.authorName !== undefined && post.publishedAt !== undefined && " · "}
            {post.publishedAt !== undefined && (
              <time dateTime={post.publishedAt}>{post.publishedAt.slice(0, 10)}</time>
            )}
          </p>
        )}

        {cover !== null && (
          <img
            src={cover}
            alt=""
            decoding="async"
            style={{ width: "100%", maxWidth: "100%", height: "auto", display: "block", borderRadius: 8, marginTop: 16 }}
          />
        )}

        {post.excerpt !== undefined && post.excerpt.trim() !== "" && (
          <p style={{ fontSize: "1.1em", opacity: 0.85 }}>{post.excerpt}</p>
        )}

        <RichText nodes={body} />
      </article>
    </div>
  );
}
