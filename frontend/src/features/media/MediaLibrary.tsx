import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError } from "@/api/client";
import { mediaApi, mediaSrcSet, mediaUrl, type MediaAsset } from "@/api/media";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

type LoadState =
  | { status: "loading" }
  | { status: "error"; code: string }
  | { status: "ready"; assets: MediaAsset[] };

/**
 * Reusable media library.
 *
 * The same component backs the standalone Media route and the image picker inside the builder, so
 * an asset is uploaded once and selected anywhere. Thumbnails request the smallest variant rather
 * than the full-size image — a grid that downloads originals is how a media library becomes the
 * slowest screen in the product.
 */
export function MediaLibrary({
  workspaceId,
  projectId,
  onSelect,
}: {
  workspaceId: string;
  /** The site this library belongs to. Uploads land here and the listing is confined to it. */
  projectId: string;
  onSelect?: (asset: MediaAsset) => void;
}) {
  const { t } = useTranslation(["dashboard", "errors", "common"]);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MediaAsset | null>(null);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const searchId = useId();

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: "loading" });
      try {
        const assets = await mediaApi.list(workspaceId, projectId, signal ? { signal } : {});
        setState({ status: "ready", assets });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error", code: error instanceof ApiError ? error.code : "INTERNAL_ERROR" });
      }
    },
    [workspaceId, projectId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const upload = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      await mediaApi.upload(workspaceId, projectId, file);
      await load();
    } catch (error) {
      // The server decides what is acceptable; the client only translates its answer.
      const code = error instanceof ApiError ? error.code : "INTERNAL_ERROR";
      setUploadError(
        code === "UNSUPPORTED_MEDIA_TYPE"
          ? t("dashboard:media.rejected")
          : code === "PAYLOAD_TOO_LARGE"
            ? t("dashboard:media.tooLarge")
            : t(`errors:${code}` as "errors:INTERNAL_ERROR"),
      );
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const assets =
    state.status === "ready"
      ? state.assets.filter((asset) => asset.originalFilename.toLowerCase().includes(query.trim().toLowerCase()))
      : [];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink-900">{t("dashboard:media.title")}</h2>
          <p className="mt-1 text-sm text-ink-600">{t("dashboard:media.description")}</p>
        </div>

        <div className="flex items-end gap-2">
          <label htmlFor={searchId} className="text-xs font-medium text-ink-600">
            {t("dashboard:media.search")}
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="mt-1 block rounded-md border border-ink-200 px-2 py-1.5 text-sm text-ink-900"
            />
          </label>

          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700
              disabled:opacity-50"
          >
            {uploading ? t("dashboard:media.uploading") : t("dashboard:media.upload")}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            aria-label={t("dashboard:media.upload")}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
        </div>
      </div>

      {uploadError !== null && (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {uploadError}
        </p>
      )}

      <div className="mt-6">
        {state.status === "loading" && (
          <p role="status" className="rounded-lg border border-ink-100 p-8 text-center text-ink-500">
            {t("dashboard:media.loading")}
          </p>
        )}

        {state.status === "error" && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-6">
            <h3 className="font-medium text-red-900">{t("dashboard:media.error")}</h3>
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

        {state.status === "ready" && state.assets.length === 0 && (
          <div className="rounded-lg border border-dashed border-ink-200 p-10 text-center">
            <h3 className="font-medium text-ink-900">{t("dashboard:media.empty.title")}</h3>
            <p className="mt-1 text-sm text-ink-600">{t("dashboard:media.empty.description")}</p>
          </div>
        )}

        {state.status === "ready" && state.assets.length > 0 && assets.length === 0 && (
          <p className="rounded-lg border border-dashed border-ink-200 p-8 text-center text-ink-500">
            {t("dashboard:media.noMatches")}
          </p>
        )}

        {assets.length > 0 && (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {assets.map((asset) => (
              <li key={asset.id} className="overflow-hidden rounded-lg border border-ink-200 bg-white">
                <img
                  src={mediaUrl(workspaceId, asset.id, 320)}
                  srcSet={mediaSrcSet(workspaceId, asset)}
                  sizes="(min-width: 1024px) 320px, 50vw"
                  width={asset.width}
                  height={asset.height}
                  /*
                   * In a media library the image is the content, not decoration. An empty alt
                   * would drop every thumbnail out of the accessibility tree and leave a screen
                   * reader user with a grid of nothing, identifiable only by adjacent text.
                   */
                  alt={asset.defaultAlt ?? asset.originalFilename}
                  loading="lazy"
                  decoding="async"
                  className="aspect-[4/3] w-full bg-ink-100 object-cover"
                />
                <div className="p-3">
                  <p className="truncate text-sm font-medium text-ink-900">{asset.originalFilename}</p>
                  <p className="mt-1 text-xs text-ink-500">
                    {t("dashboard:media.dimensions", { width: asset.width, height: asset.height })} ·{" "}
                    {t("dashboard:media.variants", { count: asset.variants.length })}
                  </p>
                  <div className="mt-3 flex gap-2">
                    {onSelect && (
                      <button
                        type="button"
                        onClick={() => onSelect(asset)}
                        className="rounded-md bg-ink-900 px-2.5 py-1 text-xs font-semibold text-white"
                      >
                        {t("dashboard:media.select")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setPendingDelete(asset)}
                      className="rounded-md border border-ink-200 px-2.5 py-1 text-xs text-ink-700"
                    >
                      {t("dashboard:media.remove")}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        destructive
        title={t("dashboard:media.removeTitle")}
        description={t("dashboard:media.removeWarning")}
        confirmLabel={t("dashboard:media.confirmRemove")}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (target === null) return;
          void mediaApi
            .remove(workspaceId, target.id)
            .then(() => load())
            .catch((error: unknown) =>
              setState({ status: "error", code: error instanceof ApiError ? error.code : "INTERNAL_ERROR" }),
            );
        }}
      />
    </div>
  );
}
