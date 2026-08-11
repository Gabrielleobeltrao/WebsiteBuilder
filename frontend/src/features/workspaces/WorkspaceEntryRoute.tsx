import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router";

import { workspacesApi } from "@/api/workspaces";

/**
 * The landing point for `/app`.
 *
 * Without it, an authenticated visitor at `/app` fell through to the catch-all and was sent to the
 * login page — which then returned them to `/app`, because that is the default return path. Signing
 * in put people in a loop between the two.
 *
 * The active workspace from the session is used when the session has one; otherwise the user's own
 * workspaces are read from the server, which is the only source that can be trusted for it.
 */
export function WorkspaceEntryRoute({ activeWorkspaceId }: { activeWorkspaceId: string }) {
  const { t } = useTranslation("common");
  const [resolved, setResolved] = useState<string | null>(activeWorkspaceId || null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (resolved !== null) return;

    const controller = new AbortController();
    workspacesApi
      .list({ signal: controller.signal })
      .then((workspaces) => {
        const target = workspaces.find((workspace) => workspace.kind === "personal") ?? workspaces[0];
        if (target === undefined) setFailed(true);
        else setResolved(target.id);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed(true);
      });

    return () => controller.abort();
  }, [resolved]);

  if (resolved !== null) return <Navigate to={`/app/${resolved}/overview`} replace />;

  // A session with no workspace at all is a broken account rather than a signed-out visitor, so it
  // does not silently become a login redirect.
  if (failed) {
    return (
      <p role="alert" className="p-10 text-center text-ink-600">
        {t("state.error")}
      </p>
    );
  }

  return (
    <p role="status" className="p-10 text-center text-ink-500">
      {t("state.loading")}
    </p>
  );
}
