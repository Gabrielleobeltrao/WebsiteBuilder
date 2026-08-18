import {
  BLOG_FORMATS,
  blogFormatOf,
  isDomainLive,
  postPath,
  type BlogFormat,
  type BlogPost,
  type BlogSettings,
} from "@websitebuilder/shared";
import { useCallback, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { blogApi, type PostPage } from "@/api/blog";
import { publishingApi } from "@/api/publishing";
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
  /** Counts for the whole blog, not for the filter currently applied to the list below. */
  const [counts, setCounts] = useState<{ published: number; drafts: number }>({ published: 0, drafts: 0 });
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [pendingDelete, setPendingDelete] = useState<BlogPost | null>(null);
  /**
   * The address a visitor would actually open, when there is one.
   *
   * Same source as the publish screen, so the two cannot disagree about where this site lives. A
   * site with no live hostname is not an error here — it just means the best available way to look
   * at a post is the draft preview rather than the real page.
   */
  const [liveHost, setLiveHost] = useState<string | null>(null);

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

        // Separate and forgiving: no address is an ordinary state for a site nobody has published,
        // and it must not turn the post list into an error screen.
        try {
          const domains = await publishingApi.domains(workspaceId, projectId, signal ? { signal } : {});
          const primary = domains.find((domain) => domain.isPrimary && isDomainLive(domain));
          setLiveHost(primary?.hostname ?? null);
        } catch {
          setLiveHost(null);
        }

        // Asked for separately because the list is filtered and paginated: counting its rows would
        // report "3 published" to somebody who had just filtered to drafts.
        if (loadedSettings.enabled) {
          const [published, drafts] = await Promise.all([
            blogApi.listPosts(workspaceId, projectId, { status: "published", ...(signal ? { signal } : {}) }),
            blogApi.listPosts(workspaceId, projectId, { status: "draft", ...(signal ? { signal } : {}) }),
          ]);
          setCounts({ published: published.total, drafts: drafts.total });
        }
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

  const activate = async (format: BlogFormat) => {
    // One request, and the server does the rest: creating both templates and pointing the settings
    // at them is what makes a blog that is on a blog that can serve its own routes.
    await blogApi.activate(workspaceId, projectId, format);
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
    return <ChooseFormat onChoose={(format) => void activate(format)} />;
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-950">{t("blog:title")}</h1>
          <p className="mt-1 text-sm text-ink-600">{t("blog:description")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* The layout every article is drawn with, edited in the same builder as the site. Placed
              beside "new post" because designing the shape and writing into it are the two things
              somebody comes to this screen to do. */}
          <Link
            to={`${basePath}/templates/article`}
            className="rounded-md border border-ink-200 px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
          >
            {t("blog:templates.article")}
          </Link>
          <Link
            to={`${basePath}/templates/index`}
            className="rounded-md border border-ink-200 px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
          >
            {t("blog:templates.index")}
          </Link>
          <Link
            to={`${basePath}/posts/new`}
            className="rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700"
          >
            {t("blog:posts.create")}
          </Link>
        </div>
      </div>

      {settings !== null && (
        <BlogSummary
          settings={settings}
          counts={counts}
          onFormat={(format) => void run(() => blogApi.saveSettings(workspaceId, projectId, { ...settings, format }))}
        />
      )}

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
                    {/*
                      The post's own page, by the best route that actually exists.
                      
                      A published post on a site with a live address gets the real page. A published
                      post on a site with no address yet gets the draft preview, which renders the
                      same article without needing a hostname. A draft gets neither, because an
                      unpublished post claims no route anywhere — offering a button to it would send
                      someone to the site's 404 and look like a bug rather than a status.
                    */}
                    {post.status === "published" &&
                      (liveHost !== null ? (
                        <a
                          href={`https://${liveHost}${postPath(settings?.basePath ?? "/blog", post.slug)}`}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50"
                        >
                          {t("blog:posts.viewPage")}
                        </a>
                      ) : (
                        <Link
                          to={`/preview/${workspaceId}/${projectId}${postPath(settings?.basePath ?? "/blog", post.slug)}`}
                          className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50"
                        >
                          {t("blog:posts.previewPage")}
                        </Link>
                      ))}
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


/**
 * The one decision turning a blog on actually requires.
 *
 * A format rather than a switch, because a blog that is merely "on" has nothing to show: it needs
 * an index and an article page before either of the routes it publishes can answer. Choosing here
 * creates both, which is also what stops an activated blog from blocking publication of the site.
 *
 * Three arrangements, not a layout editor. What an index has to decide is how much of each post to
 * show and how many fit across; everything past that is a page somebody should be designing.
 */
function ChooseFormat({ onChoose }: { onChoose: (format: BlogFormat) => void }) {
  const { t } = useTranslation(["blog", "common"]);
  const [chosen, setChosen] = useState<BlogFormat>("list");
  const [busy, setBusy] = useState(false);

  return (
    <div className="rounded-xl border border-dashed border-ink-200 p-8 text-center">
      <h2 className="font-display text-lg font-semibold text-ink-900">{t("blog:activate.title")}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-600">{t("blog:activate.description")}</p>

      <fieldset className="mx-auto mt-6 grid max-w-2xl gap-3 sm:grid-cols-3">
        <legend className="sr-only">{t("blog:activate.formatLegend")}</legend>

        {BLOG_FORMATS.map((format) => (
          <label
            key={format}
            className={[
              "cursor-pointer rounded-lg border p-4 text-left",
              chosen === format ? "border-accent-500 ring-2 ring-accent-200" : "border-ink-200",
            ].join(" ")}
          >
            <span className="flex items-center gap-2">
              <input
                type="radio"
                name="blog-format"
                value={format}
                checked={chosen === format}
                onChange={() => setChosen(format)}
              />
              <span className="text-sm font-medium text-ink-900">
                {t(`blog:activate.format.${format}.name` as "blog:activate.format.list.name")}
              </span>
            </span>
            <span className="mt-1 block text-xs text-ink-600">
              {t(`blog:activate.format.${format}.description` as "blog:activate.format.list.description")}
            </span>
            <FormatSketch format={format} />
          </label>
        ))}
      </fieldset>

      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          onChoose(chosen);
        }}
        className="mt-6 rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {t("blog:activate.action")}
      </button>

      <p className="mt-3 text-xs text-ink-500">{t("blog:activate.changeable")}</p>
    </div>
  );
}

/** A shape, not a screenshot: enough to tell three arrangements apart at a glance. */
function FormatSketch({ format }: { format: BlogFormat }) {
  const bars = format === "list" ? [1] : format === "grid" ? [3, 3] : [1, 2];

  return (
    <span aria-hidden className="mt-3 block space-y-1">
      {bars.map((count, row) => (
        <span key={row} className="flex gap-1">
          {Array.from({ length: count }, (_, cell) => (
            <span
              key={cell}
              className={`block rounded-sm bg-ink-200 ${row === 0 && format === "magazine" ? "h-6" : "h-3"}`}
              style={{ flex: 1 }}
            />
          ))}
        </span>
      ))}
    </span>
  );
}


/**
 * What this blog currently is, before the list of what is in it.
 *
 * The three numbers somebody opening this screen actually came for — how much is live, how much is
 * waiting, and where a reader finds it — plus the format, changeable from here because a decision
 * made once at activation should not be locked by that.
 */
function BlogSummary({
  settings,
  counts,
  onFormat,
}: {
  settings: BlogSettings;
  counts: { published: number; drafts: number };
  onFormat: (format: BlogFormat) => void;
}) {
  const { t } = useTranslation(["blog", "common"]);
  const formatId = useId();
  const { published, drafts } = counts;

  return (
    <section aria-labelledby="blog-summary" className="mt-6 rounded-xl border border-ink-200 bg-white p-4">
      <h2 id="blog-summary" className="sr-only">
        {t("blog:summary.title")}
      </h2>

      <dl className="grid gap-4 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-ink-500">{t("blog:summary.published")}</dt>
          <dd className="mt-1 font-display text-2xl font-semibold text-ink-900">{published}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-500">{t("blog:summary.drafts")}</dt>
          <dd className="mt-1 font-display text-2xl font-semibold text-ink-900">{drafts}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-500">{t("blog:summary.address")}</dt>
          <dd className="mt-1 font-mono text-sm text-ink-700">{settings.basePath}</dd>
        </div>
        <div>
          <label htmlFor={formatId} className="text-xs text-ink-500">
            {t("blog:activate.formatLegend")}
          </label>
          <select
            id={formatId}
            value={blogFormatOf(settings)}
            onChange={(event) => onFormat(event.target.value as BlogFormat)}
            className="mt-1 w-full rounded-md border border-ink-200 px-2 py-1.5 text-sm text-ink-900"
          >
            {BLOG_FORMATS.map((value) => (
              <option key={value} value={value}>
                {t(`blog:activate.format.${value}.name` as "blog:activate.format.list.name")}
              </option>
            ))}
          </select>
        </div>
      </dl>
    </section>
  );
}
