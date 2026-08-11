import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";

import { projectsApi } from "@/api/projects";
import { PageMetadata } from "@/components/common/PageMetadata";
import { SiteDashboard } from "@/features/sites/SiteDashboard";

type Summary = { name: string; pageCount: number; updatedAt: string } | null;

export function SiteDashboardRoute() {
  const { t } = useTranslation(["dashboard", "common"]);
  const { workspaceId = "", projectId = "" } = useParams();
  const [summary, setSummary] = useState<Summary>(null);

  useEffect(() => {
    const controller = new AbortController();
    projectsApi
      .list(workspaceId, { signal: controller.signal })
      .then((projects) => {
        const found = projects.find((project) => project.id === projectId);
        if (found) setSummary({ name: found.name, pageCount: found.pageCount, updatedAt: found.updatedAt });
      })
      .catch(() => setSummary(null));
    return () => controller.abort();
  }, [workspaceId, projectId]);

  return (
    <div className="px-6 py-10 sm:px-10">
      <PageMetadata title={`${summary?.name ?? t("dashboard:site.title")} — ${t("common:productName")}`} />
      <div className="mx-auto max-w-4xl">
        <SiteDashboard
          workspaceId={workspaceId}
          projectId={projectId}
          projectName={summary?.name ?? t("dashboard:site.title")}
          pageCount={summary?.pageCount ?? 0}
        onRenamed={(name) => setSummary((current) => (current === null ? current : { ...current, name }))}
          updatedAt={summary?.updatedAt ?? new Date().toISOString()}
        />
      </div>
    </div>
  );
}
