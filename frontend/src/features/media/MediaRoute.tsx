import { useTranslation } from "react-i18next";
import { useParams } from "react-router";

import { PageMetadata } from "@/components/common/PageMetadata";
import { MediaLibrary } from "@/features/media/MediaLibrary";

export function MediaRoute() {
  const { t } = useTranslation(["dashboard", "common"]);
  const { workspaceId = "", projectId = "" } = useParams();

  return (
    <div className="px-6 py-10 sm:px-10">
      <PageMetadata title={`${t("dashboard:media.title")} — ${t("common:productName")}`} />
      <div className="mx-auto max-w-5xl">
        <MediaLibrary workspaceId={workspaceId} projectId={projectId} />
      </div>
    </div>
  );
}
