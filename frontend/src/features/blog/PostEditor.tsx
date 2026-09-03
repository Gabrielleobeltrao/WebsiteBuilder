import {
  EMPTY_RICH_TEXT,
  normalizePostSlug,
  type BlogFieldDefinition,
  type BlogPostInput,
} from "@websitebuilder/shared";
import { useCallback, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import { blogApi } from "@/api/blog";
import { ApiError } from "@/api/client";
import { mediaUrl } from "@/api/media";
import { MediaLibrary } from "@/features/media/MediaLibrary";
import { RichTextEditor } from "@/components/common/RichTextEditor";

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
  const { t } = useTranslation(["blog", "errors", "common"]);
  const navigate = useNavigate();
  const titleId = useId();

  const [post, setPost] = useState<BlogPostInput>(emptyPost);
  const [loading, setLoading] = useState(postId !== undefined);
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" } | { kind: "error"; message: string }>({
    kind: "idle",
  });
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
    setStatus({ kind: "idle" });
  }, []);

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

      const saved =
        postId === undefined
          ? await blogApi.createPost(workspaceId, projectId, payload)
          : await blogApi.updatePost(workspaceId, projectId, postId, payload);

      setStatus({ kind: "saved" });
      if (postId === undefined) void navigate(`${basePath}/posts/${saved.id}/edit`, { replace: true });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "INTERNAL_ERROR";
      setStatus({ kind: "error", message: t(`errors:${code}` as "errors:INTERNAL_ERROR") });
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
          {status.kind === "saved" && (
            <span role="status" className="text-xs text-accent-800">
              {t("blog:editor.saved")}
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
          One control per distinct field definition, keyed by the stable id. Two dynamic image
          bindings in a template therefore produce two independently saved inputs.
        */}
        {fieldDefinitions.map((definition) => (
          <Field key={definition.id} label={definition.label} hint={definition.helpText}>
            {(id) =>
              definition.type === "longText" ? (
                <textarea
                  id={id}
                  rows={3}
                  required={definition.required}
                  value={String(post.customFieldValues[definition.id] ?? "")}
                  onChange={(event) =>
                    patch({ customFieldValues: { ...post.customFieldValues, [definition.id]: event.target.value } })
                  }
                  className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
                />
              ) : (
                <input
                  id={id}
                  type={definition.type === "date" ? "date" : "text"}
                  required={definition.required}
                  value={String(post.customFieldValues[definition.id] ?? "")}
                  onChange={(event) =>
                    patch({ customFieldValues: { ...post.customFieldValues, [definition.id]: event.target.value } })
                  }
                  className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
                />
              )
            }
          </Field>
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
