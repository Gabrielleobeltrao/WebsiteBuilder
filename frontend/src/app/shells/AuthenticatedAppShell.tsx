import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useParams } from "react-router";

import { workspacesApi, type WorkspaceSummary } from "@/api/preferences";
import { signOut } from "@/features/auth/authClient";

/**
 * Permanent application shell for authenticated routes.
 *
 * A separate route layout from `PublicShell`, never a conditional inside it. Phase 11 grows the
 * navigation into the full workspace/site structure; what matters now is that only one left shell
 * is ever mounted and that the workspace switcher reads real memberships from the server.
 */
export function AuthenticatedAppShell() {
  const { t } = useTranslation(["auth", "common", "dashboard"]);
  const { workspaceId = "" } = useParams();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    workspacesApi
      .list({ signal: controller.signal })
      .then(setWorkspaces)
      .catch(() => setWorkspaces([]));
    return () => controller.abort();
  }, []);

  return (
    <div className="min-h-dvh lg:flex">
      <a href="#app-content" className="skip-link">
        {t("common:skipToContent")}
      </a>

      <aside
        aria-label={t("auth:workspace")}
        className="shrink-0 border-b border-ink-100 p-4 lg:w-60 lg:border-b-0 lg:border-r"
      >
        <Link to="/" className="flex items-center gap-2 text-ink-900">
          <span aria-hidden className="grid size-7 place-items-center rounded-lg bg-ink-900 text-xs font-bold text-white">
            W
          </span>
          <span className="font-display text-sm font-semibold">{t("common:productName")}</span>
        </Link>

        {workspaces.length > 0 && (
          <label className="mt-4 block text-xs font-medium text-ink-600">
            {t("auth:workspace")}
            <select
              value={workspaceId}
              onChange={(event) => {
                globalThis.location.assign(`/app/${event.target.value}/sites`);
              }}
              className="mt-1 w-full rounded-md border border-ink-200 px-2 py-1.5 text-sm text-ink-900"
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <nav aria-label={t("common:productName")} className="mt-4">
          <ul className="space-y-1">
            <li>
              <NavLink
                to={`/app/${workspaceId}/sites`}
                className={({ isActive }) =>
                  [
                    "block rounded-md px-3 py-2 text-sm font-medium",
                    isActive ? "bg-ink-100 text-ink-900" : "text-ink-600 hover:bg-ink-50",
                  ].join(" ")
                }
              >
                {t("dashboard:sites.title")}
              </NavLink>
            </li>
            <li>
              <NavLink
                to={`/app/${workspaceId}/settings`}
                className={({ isActive }) =>
                  [
                    "block rounded-md px-3 py-2 text-sm font-medium",
                    isActive ? "bg-ink-100 text-ink-900" : "text-ink-600 hover:bg-ink-50",
                  ].join(" ")
                }
              >
                {t("auth:settings")}
              </NavLink>
            </li>
          </ul>
        </nav>

        <button
          type="button"
          onClick={() => {
            void signOut().then(() => globalThis.location.assign("/"));
          }}
          className="mt-6 w-full rounded-md border border-ink-200 px-3 py-2 text-sm font-medium text-ink-700"
        >
          {t("auth:signOut")}
        </button>
      </aside>

      <main id="app-content" className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
