import { ImagePlus, X } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";

import { MediaLibrary } from "@/features/media/MediaLibrary";

/**
 * Choosing an image from the workspace's own library.
 *
 * Typing an identifier by hand was the only way to fill a media field, which asked a designer to
 * know a database id and made a tenant-crossing reference a typo away. The library is scoped to the
 * workspace by the API, so what can be picked here is exactly what this workspace owns.
 */
export function MediaPickerField({
  label,
  value,
  onChange,
  onClear,
}: {
  label: string;
  value: string;
  onChange: (mediaId: string) => void;
  onClear?: () => void;
}) {
  const { t } = useTranslation("builder");
  const { workspaceId = "", projectId = "" } = useParams();
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <div>
      <p id={id} className="block text-xs font-medium text-ink-700">
        {label}
      </p>

      <div className="mt-1 flex items-center gap-1">
        <button
          type="button"
          aria-describedby={id}
          onClick={() => setOpen((current) => !current)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-ink-200 px-2 py-1.5 text-left text-xs
            text-ink-700 hover:bg-ink-50"
        >
          <ImagePlus aria-hidden className="size-3.5 shrink-0 text-ink-500" />
          <span className="truncate">{value === "" ? t("fields.chooseImage") : value}</span>
        </button>

        {value !== "" && onClear !== undefined && (
          <button
            type="button"
            aria-label={t("fields.clearImage")}
            onClick={onClear}
            className="rounded p-1 text-ink-500 hover:bg-ink-100 hover:text-ink-800"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="mt-2 max-h-72 overflow-y-auto rounded-md border border-ink-200 p-2">
          <MediaLibrary
            workspaceId={workspaceId}
            projectId={projectId}
            onSelect={(asset) => {
              onChange(asset.id);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
