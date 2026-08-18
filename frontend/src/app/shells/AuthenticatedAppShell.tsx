import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useParams } from "react-router";

import { workspacesApi, type WorkspaceSummary } from "@/api/preferences";
import { MobileNavDrawer } from "@/app/shells/MobileNavDrawer";
import { signOut } from "@/features/auth/authClient";

/**
 * Permanent application shell for authenticated routes.
 *
 * A separate route layout from `PublicShell`, never a conditional inside it. Phase 11 grows the
 * navigation into the full workspace/site structure; what matters now is that only one left shell
 * is ever mounted and that the workspace switcher reads real memberships from the server.
 *
 * Below `lg` the sidebar is a drawer rather than a block stacked above the page: at full width it
 * cost a phone its entire first screen before any content, which is the one viewport where the
 * dashboard is all a person can use — the editor needs a pointer and a canvas.
 */

function Brand({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation("common");
  return (
    <Link to="/" onClick={onNavigate} className="flex items-center gap-2 text-ink-900">
      <span aria-hidden className="grid size-7 place-items-center rounded-lg bg-ink-900 text-xs font-bold text-white">
        W
      </span>
      <span className="font-display text-sm font-semibold">{t("productName")}</span>
    </Link>
  );
}

/*
 * Workspace-level destinations only.
 *
 * Media used to sit here, which said images belonged to the account rather than to a site — so one
 * library held every site's pictures mixed together and grew unusable as soon as a customer had a
 * second site. It lives inside a site now, beside the other things a site owns.
 */
const NAV_ITEMS = [
  { segment: "overview", labelKey: "dashboard:overview.title" },
  { segment: "sites", labelKey: "dashboard:sites.title" },
  { segment: "settings", labelKey: "auth:settings" },
] as const;

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

  const sidebarContent = (onNavigate?: () => void) => (
    <>
      {workspaces.length > 0 && (
        <label className="block text-xs font-medium text-ink-600">
          {t("auth:workspace")}
          <select
            value={workspaceId}
            onChange={(event) => {
              globalThis.location.assign(`/app/${event.target.value}/overview`);
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
          {NAV_ITEMS.map((item) => (
            <li key={item.segment}>
              <NavLink
                to={`/app/${workspaceId}/${item.segment}`}
                onClick={onNavigate}
                className={({ isActive }) =>
                  [
                    "block rounded-md px-3 py-2 text-sm font-medium",
                    isActive ? "bg-ink-100 text-ink-900" : "text-ink-600 hover:bg-ink-50",
                  ].join(" ")
                }
              >
                {t(item.labelKey)}
              </NavLink>
            </li>
          ))}
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
    </>
  );

  return (
    <div className="min-h-dvh lg:flex">
      <a href="#app-content" className="skip-link">
        {t("common:skipToContent")}
      </a>

      <MobileNavDrawer id="app-drawer" label={t("common:productName")} brand={<Brand />}>
        {(close) => sidebarContent(close)}
      </MobileNavDrawer>

      <aside aria-label={t("auth:workspace")} className="hidden shrink-0 border-ink-100 p-4 lg:block lg:w-60 lg:border-r">
        <Brand />
        <div className="mt-4">{sidebarContent()}</div>
      </aside>

      <main id="app-content" className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
