import {
  resolveBinding,
  type BlogFieldDefinition,
  type BuilderPage,
  type DynamicBinding,
  type PostSample,
} from "@websitebuilder/shared";
import { useTranslation } from "react-i18next";

import { ProjectPageRenderer } from "@/components/renderer/ProjectPageRenderer";
import { useRendererContext } from "@/components/renderer/RendererContext";

/**
 * Renders one post through the published article template.
 *
 * The template is the layout; the post supplies the values. Nothing here is per-post, which is what
 * makes publishing a template change every article at once instead of requiring each one to be
 * reopened.
 */
export function BoundValue({
  binding,
  post,
  fieldDefinitions,
}: {
  binding: DynamicBinding;
  post: PostSample;
  fieldDefinitions: readonly BlogFieldDefinition[];
}) {
  const { t } = useTranslation("blog");
  const { resolveMediaUrl } = useRendererContext();
  const resolved = resolveBinding(binding, post, fieldDefinitions);

  if (resolved.state === "missing-field") {
    // Visible in the editor's sample preview so the designer can repair it; a published snapshot
    // is refused before it can contain one.
    return (
      <span role="status" className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-800">
        {t("preview.missingField")}
      </span>
    );
  }

  if (resolved.state === "empty") return null;

  if (resolved.kind === "text") return <span>{resolved.text}</span>;

  if (resolved.kind === "date") {
    // Formatted with Intl in the reader's locale rather than a stored display string.
    return <time dateTime={resolved.iso}>{new Date(resolved.iso).toLocaleDateString()}</time>;
  }

  if (resolved.kind === "media") {
    const src = resolveMediaUrl(resolved.mediaId);
    return src === null ? null : <img src={src} alt="" loading="lazy" decoding="async" />;
  }

  // Rich text arrives as validated structured JSON and is rendered as text nodes, never as HTML.
  return <RichTextView document={resolved.document} />;
}

type RichNode = { type?: string; text?: string; content?: RichNode[] };

/**
 * Renders validated rich text without `dangerouslySetInnerHTML`.
 *
 * The document was validated against the allowlist on the way in, but rendering it as markup would
 * still mean trusting stored data at display time. Walking the tree into React elements means the
 * worst a malformed document can do is render less, never execute.
 */
export function RichTextView({ document }: { document: unknown }) {
  const node = document as RichNode | undefined;
  if (node === undefined || node === null) return null;

  const renderNode = (current: RichNode, key: number): React.ReactNode => {
    if (current.type === "text") return <span key={key}>{current.text ?? ""}</span>;

    const children = (current.content ?? []).map(renderNode);
    switch (current.type) {
      case "paragraph":
        return <p key={key}>{children}</p>;
      case "heading":
        return <h2 key={key}>{children}</h2>;
      case "bulletList":
        return <ul key={key}>{children}</ul>;
      case "orderedList":
        return <ol key={key}>{children}</ol>;
      case "listItem":
        return <li key={key}>{children}</li>;
      case "blockquote":
        return <blockquote key={key}>{children}</blockquote>;
      case "hardBreak":
        return <br key={key} />;
      case "doc":
        return <div key={key}>{children}</div>;
      default:
        // An unknown node renders its children rather than itself: nothing unexpected is emitted.
        return <span key={key}>{children}</span>;
    }
  };

  return <>{renderNode(node, 0)}</>;
}

export function PublicPostRenderer({
  template,
  post,
  fieldDefinitions,
}: {
  /** The published article template. A draft never reaches here. */
  template: BuilderPage;
  post: PostSample;
  fieldDefinitions: readonly BlogFieldDefinition[];
}) {
  return (
    <article>
      <ProjectPageRenderer page={template} />
      {/*
        Until the template builder places dynamic elements on the canvas, the post body renders
        beneath the template so a published article is never an empty shell.
      */}
      <div className="prose mx-auto max-w-2xl px-6 py-8">
        <h1>{post.title}</h1>
        {post.excerpt.trim() !== "" && <p>{post.excerpt}</p>}
        <BoundValue
          binding={{ source: "system", field: "content" }}
          post={post}
          fieldDefinitions={fieldDefinitions}
        />
      </div>
    </article>
  );
}
