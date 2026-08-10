import { useTranslation } from "react-i18next";
import { useParams } from "react-router";

import { PageMetadata } from "@/components/common/PageMetadata";
import { PostEditor } from "@/features/blog/PostEditor";

export function PostEditorRoute() {
  const { t } = useTranslation(["blog", "common"]);
  const { workspaceId = "", projectId = "", postId } = useParams();

  return (
    <div className="px-6 py-10 sm:px-10">
      <PageMetadata title={`${t("blog:title")} — ${t("common:productName")}`} />
      <div className="mx-auto max-w-3xl">
        <PostEditor
          workspaceId={workspaceId}
          projectId={projectId}
          {...(postId ? { postId } : {})}
          basePath={`/app/${workspaceId}/sites/${projectId}/blog`}
        />
      </div>
    </div>
  );
}
