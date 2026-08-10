import { useTranslation } from "react-i18next";
import { useParams } from "react-router";

import { PageMetadata } from "@/components/common/PageMetadata";
import { BlogDashboard } from "@/features/blog/BlogDashboard";

export function BlogRoute() {
  const { t } = useTranslation(["blog", "common"]);
  const { workspaceId = "", projectId = "" } = useParams();

  return (
    <div className="px-6 py-10 sm:px-10">
      <PageMetadata title={`${t("blog:title")} — ${t("common:productName")}`} />
      <div className="mx-auto max-w-4xl">
        <BlogDashboard
          workspaceId={workspaceId}
          projectId={projectId}
          basePath={`/app/${workspaceId}/sites/${projectId}/blog`}
        />
      </div>
    </div>
  );
}
