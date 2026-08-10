import {
  DEFAULT_BLOG_SETTINGS,
  type BlogPost,
  type BlogSettings,
} from "@websitebuilder/shared";
import { useCallback, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { blogApi, type PostPage } from "@/api/blog";
import { ApiError } from "@/api/client";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { useRelativeTime } from "@/hooks/useRelativeTime";

type LoadState = { status: "loading" } | { status: "error"; code: string } | { status: "ready"; page: PostPage };

type StatusFilter = "all" | "draft" | "published";

/**
 * Post dashboard.
 *
 * A growing blog is managed from here, never from inside the visual builder: an editorial archive
 * is a table with filters and pagination, and forcing it through a canvas would make routine work
 * slower the more successful the blog becomes.
 */
export function BlogDashboard({
  workspaceId,
  projectId,
  basePath,
}: {
  workspaceId: string;
  projectId: string;
  basePath: string;
}) {
  const { t } = useTranslation(["blog", "errors", "common"]);
  const formatRelative = useRelativeTime();
  const searchId = useId();

  const [settings, setSettings] = useState<BlogSettings | null>(null);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [pendingDelete, setPendingDelete] = useState<BlogPost | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: "loading" });
      try {
        const [loadedSettings, page] = await Promise.all([
          blogApi.loadSettings(workspaceId, projectId, signal ? { signal } : {}),
          blogApi.listPosts(workspaceId, projectId, {
            ...(filter === "all" ? {} : { status: filter }),
            ...(search.trim() ? { search: search.trim() } : {}),
            ...(signal ? { signal } : {}),
          }),
        ]);
        setSettings(loadedSettings);
        setState({ status: "ready", page });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error", code: error instanceof ApiError ? error.code : "INTERNAL_ERROR" });
      }
    },
    [workspaceId, projectId, filter, search],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const activate = async () => {
    await blogApi.saveSettings(workspaceId, projectId, { ...DEFAULT_BLOG_SETTINGS, enabled: true });
    await load();
  };

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      await load();
    } catch (error) {
      setState({ status: "error", code: error instanceof ApiError ? error.code : "INTERNAL_ERROR" });
    }
  };

  // Activation is an explicit, recoverable choice — never a side effect of visiting this route.
  if (settings !== null && !settings.enabled) {
    return (
      <div className="rounded-xl border border-dashed border-ink-200 p-10 text-center">
        <h2 className="font-display text-lg font-semibold text-ink-900">{t("blog:activate.title")}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-600">{t("blog:activate.description")}</p>
        <button
          type="button"
          onClick={() => void activate()}
          className="mt-6 rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700"
        >
          {t("blog:activate.action")}
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-950">{t("blog:title")}</h1>
          <p className="mt-1 text-sm text-ink-600">{t("blog:description")}</p>
        </div>
        <Link
          to={`${basePath}/posts/new`}
          className="rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700"
        >
          {t("blog:posts.create")}
        </Link>
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <div role="group" aria-label={t("blog:posts.all")} className="flex gap-1">
          {(["all", "draft", "published"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={[
                "rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset",
                filter === value ? "bg-ink-900 text-white ring-ink-900" : "bg-white text-ink-700 ring-ink-200",
              ].join(" ")}
            >
              {t(`blog:posts.${value}`)}
            </button>
          ))}
        </div>

        <label htmlFor={searchId} className="text-xs font-medium text-ink-600">
          {t("blog:posts.search")}
          <input
            id={searchId}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="mt-1 block rounded-md border border-ink-200 px-2 py-1.5 text-sm text-ink-900"
          />
        </label>
      </div>

      <div className="mt-6">
        {state.status === "loading" && (
          <p role="status" className="rounded-lg border border-ink-100 p-8 text-center text-ink-500">
            {t("blog:posts.loading")}
          </p>
        )}

        {state.status === "error" && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-6">
            <h2 className="font-medium text-red-900">{t("blog:posts.error")}</h2>
            <p className="mt-1 text-sm text-red-800">{t(`errors:${state.code}` as "errors:INTERNAL_ERROR")}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-4 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-900"
            >
              {t("common:actions.retry")}
            </button>
          </div>
        )}

        {state.status === "ready" && state.page.items.length === 0 && (
          <div className="rounded-lg border border-dashed border-ink-200 p-10 text-center">
            <h2 className="font-medium text-ink-900">
              {filter === "all" && search.trim() === ""
                ? t("blog:posts.empty.title")
                : t("blog:posts.noMatches")}
            </h2>
            {filter === "all" && search.trim() === "" && (
              <p className="mt-1 text-sm text-ink-600">{t("blog:posts.empty.description")}</p>
            )}
          </div>
        )}

        {state.status === "ready" && state.page.items.length > 0 && (
          <>
            <p className="mb-3 text-xs text-ink-500">{t("blog:posts.countLabel", { count: state.page.total })}</p>
            <ul className="space-y-3">
              {state.page.items.map((post) => (
                <li
                  key={post.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-ink-200
                    bg-white px-5 py-4"
                >
                  <div className="min-w-0">
                    <h2 className="truncate font-medium text-ink-900">{post.title}</h2>
                    <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-500">
                      <span
                        className={[
                          "rounded-full px-2 py-0.5 ring-1 ring-inset",
                          post.status === "published"
                            ? "bg-accent-50 text-accent-800 ring-accent-200"
                            : "bg-ink-50 text-ink-700 ring-ink-200",
                        ].join(" ")}
                      >
                        {t(`blog:posts.status.${post.status}`)}
                      </span>
                      <span>
                        {post.status === "published" && post.publishedAt
                          ? t("blog:posts.publishedOn", { when: formatRelative(post.publishedAt) })
                          : t("blog:posts.updatedOn", { when: formatRelative(post.updatedAt) })}
                      </span>
                      <span>/{post.slug}</span>
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Link
                      to={`${basePath}/posts/${post.id}/edit`}
                      className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50"
                    >
                      {t("blog:posts.edit")}
                    </Link>
                    <button
                      type="button"
                      onClick={() =>
                        void run(() =>
                          blogApi.setPostStatus(
                            workspaceId,
                            projectId,
                            post.id,
                            post.status === "published" ? "draft" : "published",
                          ),
                        )
                      }
                      className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50"
                    >
                      {post.status === "published" ? t("blog:posts.unpublish") : t("blog:posts.publish")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(post)}
                      className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50"
                    >
                      {t("blog:posts.delete")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        destructive
        title={t("blog:posts.deleteTitle")}
        description={t("blog:posts.deleteWarning")}
        confirmLabel={t("blog:posts.confirmDelete")}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (target !== null) void run(() => blogApi.deletePost(workspaceId, projectId, target.id));
        }}
      />
    </div>
  );
}
