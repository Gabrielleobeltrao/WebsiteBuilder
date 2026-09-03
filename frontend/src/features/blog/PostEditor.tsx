import {
  EMPTY_RICH_TEXT,
  normalizePostSlug,
  type BlogFieldDefinition,
  type BlogPostInput,
  type RichTextDocument,
} from "@websitebuilder/shared";
import { useCallback, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import { blogApi } from "@/api/blog";
import { ApiError } from "@/api/client";
import { mediaUrl } from "@/api/media";
import { MediaLibrary } from "@/features/media/MediaLibrary";
import { RichTextEditor } from "@/components/common/RichTextEditor";
import { useUnsavedChangesWarning } from "@/hooks/useUnsavedChangesWarning";

/**
 * The post editor is a form, not a canvas.
 *
 * Layout belongs to the article template, which is designed once and applied to every post. If each
 * post carried its own layout there would be no template to publish, and changing the article
 * design would mean reopening every post ever written.
 *
 * Custom fields are generated from the template's stable field definitions and stored by field id,
 * so renaming a label never orphans a value.
 */
const emptyPost = (): BlogPostInput => ({
  title: "",
  slug: "",
  excerpt: "",
  content: EMPTY_RICH_TEXT,
  categoryIds: [],
  tags: [],
  customFieldValues: {},
  status: "draft",
});

export function PostEditor({
  workspaceId,
  projectId,
  postId,
  basePath,
  fieldDefinitions = [],
}: {
  workspaceId: string;
  projectId: string;
  /** Absent for a new post. */
  postId?: string;
  basePath: string;
  fieldDefinitions?: readonly BlogFieldDefinition[];
}) {
  const { t, i18n } = useTranslation(["blog", "errors", "common"]);
  const navigate = useNavigate();
  const titleId = useId();

  const [post, setPost] = useState<BlogPostInput>(emptyPost);
  const [loading, setLoading] = useState(postId !== undefined);
  const [status, setStatus] = useState<
    { kind: "idle" | "saving" | "saved" | "unsaved" | "conflict" } | { kind: "error"; message: string }
  >({ kind: "idle" });
  /**
   * What the server last confirmed.
   *
   * Two jobs, both of which the form used to do without: it says whether there is anything to lose
   * by leaving, and it carries the version a save is allowed to overwrite.
   */
  const [saved, setSaved] = useState<{ post: BlogPostInput; updatedAt?: string; publishedAt?: string }>(() => ({
    post: emptyPost(),
  }));
  const [slugTouched, setSlugTouched] = useState(false);
  const [pickingCover, setPickingCover] = useState(false);

  useEffect(() => {
    if (postId === undefined) return;
    const controller = new AbortController();

    blogApi
      .loadPost(workspaceId, projectId, postId, { signal: controller.signal })
      .then((loaded) => {
        const { id: _i, projectId: _p, workspaceId: _w, createdByUserId: _c, createdAt: _ca, updatedAt: _u, ...input } =
          loaded;
        setPost(input);
        setSaved({
          post: input,
          updatedAt: loaded.updatedAt,
          ...(loaded.publishedAt === undefined ? {} : { publishedAt: loaded.publishedAt }),
        });
        setSlugTouched(true);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus({
          kind: "error",
          message: error instanceof ApiError ? error.code : "INTERNAL_ERROR",
        });
        setLoading(false);
      });

    return () => controller.abort();
  }, [workspaceId, projectId, postId]);

  const patch = useCallback((values: Partial<BlogPostInput>) => {
    setPost((current) => ({ ...current, ...values }));
    // "Saved" must stop being true the moment it stops being true, or the badge is a claim about
    // work that only exists in this tab.
    setStatus({ kind: "unsaved" });
  }, []);

  const dirty = JSON.stringify(post) !== JSON.stringify(saved.post);
  useUnsavedChangesWarning(dirty);

  const save = async () => {
    if (post.title.trim().length === 0) {
      setStatus({ kind: "error", message: t("blog:editor.required") });
      return;
    }
    setStatus({ kind: "saving" });

    try {
      // A slug the author never touched follows the title, which is what they expect; once they
      // edit it, it is theirs and the title stops overwriting it.
      const payload: BlogPostInput = { ...post, slug: slugTouched ? post.slug : normalizePostSlug(post.title) };

      const stored =
        postId === undefined
          ? await blogApi.createPost(workspaceId, projectId, payload)
          : await blogApi.updatePost(workspaceId, projectId, postId, payload, saved.updatedAt);

      setPost({ ...payload, ...(stored.publishedAt === undefined ? {} : { publishedAt: stored.publishedAt }) });
      setSaved({
        post: { ...payload, ...(stored.publishedAt === undefined ? {} : { publishedAt: stored.publishedAt }) },
        updatedAt: stored.updatedAt,
        ...(stored.publishedAt === undefined ? {} : { publishedAt: stored.publishedAt }),
      });
      setStatus({ kind: "saved" });
      if (postId === undefined) void navigate(`${basePath}/posts/${stored.id}/edit`, { replace: true });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "INTERNAL_ERROR";
      // Named rather than reported as a generic failure: the author has not lost their draft, and
      // what they have to do about it is not "try again".
      setStatus(code === "REVISION_CONFLICT" ? { kind: "conflict" } : { kind: "error", message: t(`errors:${code}` as "errors:INTERNAL_ERROR") });
    }
  };

  if (loading) {
    return (
      <p role="status" className="p-10 text-center text-ink-500">
        {t("blog:posts.loading")}
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to={basePath} className="text-sm font-medium text-ink-600 underline underline-offset-4">
          {t("blog:editor.back")}
        </Link>
        <div className="flex items-center gap-3">
          {/* One place that says where the work is, rather than a badge that appears once and
              stays. "Saved" that survives the next keystroke is a false statement. */}
          {(status.kind === "saved" || status.kind === "unsaved") && (
            <span role="status" className={status.kind === "saved" ? "text-xs text-accent-800" : "text-xs text-ink-500"}>
              {t(status.kind === "saved" ? "blog:editor.saved" : "blog:editor.unsaved")}
            </span>
          )}
          <button
            type="button"
            onClick={() => void save()}
            disabled={status.kind === "saving"}
            className="rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700
              disabled:opacity-50"
          >
            {status.kind === "saving" ? t("blog:editor.saving") : t("blog:editor.save")}
          </button>
        </div>
      </div>

      <h1 id={titleId} className="mt-6 font-display text-2xl font-semibold tracking-tight text-ink-950">
        {postId === undefined ? t("blog:editor.newPost") : post.title || t("blog:editor.newPost")}
      </h1>

      {status.kind === "error" && (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {status.message}
        </p>
      )}

      {/*
        Somebody else saved this post while it was open.

        The draft in this tab is not thrown away and not merged: two prose versions cannot be
        combined by a machine without quietly destroying one of them. The author is told what
        happened, can read the newer version, and decides.
      */}
      {status.kind === "conflict" && (
        <div role="alert" className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p>{t("blog:editor.conflict")}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 rounded-md border border-amber-300 px-2 py-1 text-xs font-medium hover:bg-amber-100"
          >
            {t("blog:editor.conflictReload")}
          </button>
        </div>
      )}

      <form className="mt-6 space-y-5" onSubmit={(event) => event.preventDefault()}>
        <Field label={t("blog:editor.titleLabel")}>
          {(id) => (
            <input
              id={id}
              value={post.title}
              onChange={(event) => patch({ title: event.target.value })}
              className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
            />
          )}
        </Field>

        <Field label={t("blog:editor.slugLabel")}>
          {(id) => (
            <input
              id={id}
              value={slugTouched ? post.slug : normalizePostSlug(post.title)}
              onChange={(event) => {
                setSlugTouched(true);
                patch({ slug: event.target.value });
              }}
              className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
            />
          )}
        </Field>

        <Field label={t("blog:editor.excerptLabel")}>
          {(id) => (
            <textarea
              id={id}
              rows={3}
              value={post.excerpt}
              onChange={(event) => patch({ excerpt: event.target.value })}
              className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
            />
          )}
        </Field>

        {/*
          The cover, which the model has always carried and nothing could set.
          
          `coverMediaId` is in the post schema, the index cards draw it and the article draws it —
          and no field anywhere in the product wrote one, so every post's cover was permanently
          absent and a template block bound to it was guaranteed to render nothing.
        */}
        <div>
          <p className="mb-1 block text-sm font-medium text-ink-700">{t("blog:editor.coverLabel")}</p>

          {post.coverMediaId === undefined ? (
            <p className="text-xs text-ink-500">{t("blog:editor.coverEmpty")}</p>
          ) : (
            <div className="flex items-center gap-3">
              <img
                src={mediaUrl(workspaceId, post.coverMediaId, 240)}
                alt=""
                className="h-16 w-24 rounded-md object-cover ring-1 ring-ink-200"
              />
              <button
                type="button"
                onClick={() => patch({ coverMediaId: undefined })}
                className="rounded-md border border-ink-200 px-2 py-1 text-xs text-ink-700 hover:bg-ink-50"
              >
                {t("blog:editor.coverRemove")}
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setPickingCover((open) => !open)}
            aria-expanded={pickingCover}
            className="mt-2 rounded-md border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
          >
            {t(pickingCover ? "blog:editor.coverClose" : "blog:editor.coverChoose")}
          </button>

          {pickingCover && (
            <div className="mt-2 max-h-72 overflow-y-auto rounded-md border border-ink-200 p-2">
              <MediaLibrary
                workspaceId={workspaceId}
                projectId={projectId}
                onSelect={(asset) => {
                  patch({ coverMediaId: asset.id });
                  setPickingCover(false);
                }}
              />
            </div>
          )}
        </div>

        <div>
          <p className="mb-1 block text-sm font-medium text-ink-700">{t("blog:editor.contentLabel")}</p>
          <RichTextEditor
            value={post.content}
            onChange={(content) => patch({ content })}
            label={t("blog:editor.contentLabel")}
          />
        </div>

        <Field label={t("blog:editor.authorLabel")}>
          {(id) => (
            <input
              id={id}
              value={post.authorName ?? ""}
              onChange={(event) => patch({ authorName: event.target.value })}
              className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
            />
          )}
        </Field>

        {/*
          One control per distinct field definition, keyed by the stable id, and the control that
          matches the field's type.

          Every type but two used to render as a text input over `String(value)`. A media field
          therefore showed a raw asset id and invited somebody to type over it; a rich-text field
          showed "[object Object]" and saving destroyed the document. Both are values that cannot
          survive the round trip to a published page, so neither is offered as text any more.
        */}
        {fieldDefinitions.map((definition) => (
          <CustomField
            key={definition.id}
            definition={definition}
            workspaceId={workspaceId}
            projectId={projectId}
            value={post.customFieldValues[definition.id]}
            onChange={(value) =>
              patch({ customFieldValues: { ...post.customFieldValues, [definition.id]: value } })
            }
          />
        ))}

        <Field label={t("blog:editor.seoTitleLabel")}>
          {(id) => (
            <input
              id={id}
              value={post.seoTitle ?? ""}
              onChange={(event) => patch({ seoTitle: event.target.value })}
              className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
            />
          )}
        </Field>

        <Field label={t("blog:editor.seoDescriptionLabel")}>
          {(id) => (
            <textarea
              id={id}
              rows={2}
              value={post.seoDescription ?? ""}
              onChange={(event) => patch({ seoDescription: event.target.value })}
              className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
            />
          )}
        </Field>

        {/*
          Whether anybody can read it.

          The model has carried this from the first commit, the public feed filters on it, and no
          control anywhere set it — so every post ever written stayed a draft, and a customer who
          wrote and published and looked at their site correctly reported that the blog was empty.
          The date is stamped by the server on the first publication and never moved again, which is
          why it is shown here and not edited.
        */}
        <fieldset className="rounded-md border border-ink-200 p-3">
          <legend className="px-1 text-sm font-medium text-ink-700">{t("blog:editor.visibilityLabel")}</legend>

          <div className="flex flex-wrap gap-4">
            {(["draft", "published"] as const).map((value) => (
              <label key={value} className="flex items-center gap-2 text-sm text-ink-800">
                <input
                  type="radio"
                  name="post-status"
                  value={value}
                  checked={post.status === value}
                  onChange={() => patch({ status: value })}
                />
                {t(value === "draft" ? "blog:editor.visibilityDraft" : "blog:editor.visibilityPublished")}
              </label>
            ))}
          </div>

          <p className="mt-2 text-xs text-ink-500">
            {t(post.status === "published" ? "blog:editor.visibilityPublishedHint" : "blog:editor.visibilityDraftHint")}
          </p>

          {saved.publishedAt !== undefined && (
            <p className="mt-1 text-xs text-ink-500">
              {t("blog:editor.publishedOn", { date: new Date(saved.publishedAt).toLocaleDateString(i18n.language) })}
            </p>
          )}
        </fieldset>
      </form>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink-700">
        {label}
      </label>
      {children(id)}
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

/**
 * One custom field, drawn by its declared type.
 *
 * Which control a field gets is not cosmetic: it decides whether the value the author leaves behind
 * can be rendered on the published page at all. A media field typed as text stores a string that is
 * not an asset id; a rich-text field typed as text stores a string where the renderer expects a
 * document. Both look like they worked and fail where nobody is watching — on the live site.
 *
 * The two types with no control here keep their stored value and say so. A field that cannot be
 * filled in is a gap; a field that quietly accepts the wrong shape is a broken page.
 */
function CustomField({
  definition,
  workspaceId,
  projectId,
  value,
  onChange,
}: {
  definition: BlogFieldDefinition;
  workspaceId: string;
  projectId: string;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { t } = useTranslation(["blog"]);
  const [picking, setPicking] = useState(false);

  if (definition.type === "richText") {
    return (
      <div>
        <p className="mb-1 block text-sm font-medium text-ink-700">{definition.label}</p>
        <RichTextEditor
          value={isRichText(value) ? value : EMPTY_RICH_TEXT}
          onChange={(content) => onChange(content)}
          label={definition.label}
        />
        {definition.helpText !== undefined && <p className="mt-1 text-xs text-ink-500">{definition.helpText}</p>}
      </div>
    );
  }

  if (definition.type === "image") {
    const mediaId = typeof value === "string" && value !== "" ? value : undefined;
    return (
      <div>
        <p className="mb-1 block text-sm font-medium text-ink-700">{definition.label}</p>
        {/* Never an address built from an empty id: that is a request for `/media//content`, which
            is a 404 the browser reports as a broken image on the author's own screen. */}
        {mediaId === undefined ? (
          <p className="text-xs text-ink-500">{t("blog:editor.coverEmpty")}</p>
        ) : (
          <div className="flex items-center gap-3">
            <img
              src={mediaUrl(workspaceId, mediaId, 240)}
              alt=""
              className="h-16 w-24 rounded-md object-cover ring-1 ring-ink-200"
            />
            <button
              type="button"
              onClick={() => onChange(undefined)}
              className="rounded-md border border-ink-200 px-2 py-1 text-xs text-ink-700 hover:bg-ink-50"
            >
              {t("blog:editor.coverRemove")}
            </button>
          </div>
        )}

        {/* Named for its own field: the cover has a button with the same words, and two identical
            buttons on one form are indistinguishable to anybody listing them. */}
        <button
          type="button"
          onClick={() => setPicking((open) => !open)}
          aria-expanded={picking}
          aria-label={t("blog:editor.fieldImageChoose", { field: definition.label })}
          className="mt-2 rounded-md border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
        >
          {t(picking ? "blog:editor.coverClose" : "blog:editor.coverChoose")}
        </button>

        {picking && (
          <div className="mt-2 max-h-72 overflow-y-auto rounded-md border border-ink-200 p-2">
            <MediaLibrary
              workspaceId={workspaceId}
              projectId={projectId}
              onSelect={(asset) => {
                onChange(asset.id);
                setPicking(false);
              }}
            />
          </div>
        )}
      </div>
    );
  }

  if (definition.type === "gallery" || definition.type === "link") {
    return (
      <div>
        <p className="mb-1 block text-sm font-medium text-ink-700">{definition.label}</p>
        <p className="text-xs text-ink-500">{t("blog:editor.fieldNotEditable")}</p>
      </div>
    );
  }

  const text = typeof value === "string" ? value : "";
  return (
    <Field label={definition.label} hint={definition.helpText}>
      {(id) =>
        definition.type === "longText" ? (
          <textarea
            id={id}
            rows={3}
            required={definition.required}
            value={text}
            onChange={(event) => onChange(event.target.value)}
            className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
          />
        ) : (
          <input
            id={id}
            type={definition.type === "date" ? "date" : "text"}
            required={definition.required}
            value={text}
            onChange={(event) => onChange(event.target.value)}
            className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
          />
        )
      }
    </Field>
  );
}

/** A stored value that is already a rich-text document, rather than a string left by an old form. */
function isRichText(value: unknown): value is RichTextDocument {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "doc";
}
