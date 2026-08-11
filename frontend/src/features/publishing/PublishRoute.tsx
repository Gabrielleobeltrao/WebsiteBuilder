import { useTranslation } from "react-i18next";
import { useParams } from "react-router";

import { PageMetadata } from "@/components/common/PageMetadata";
import { PublishPanel } from "@/features/publishing/PublishPanel";

export function PublishRoute() {
  const { t } = useTranslation(["publishing", "common"]);
  const { workspaceId = "", projectId = "" } = useParams();

  return (
    <div className="px-6 py-10 sm:px-10">
      <PageMetadata title={`${t("publishing:publish.title")} — ${t("common:productName")}`} />
      <div className="mx-auto max-w-4xl">
        <PublishPanel workspaceId={workspaceId} projectId={projectId} />
      </div>
    </div>
  );
}
