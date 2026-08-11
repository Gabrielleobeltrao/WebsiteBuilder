import { Navigate, Route, Routes, useLocation, useParams } from "react-router";

import { AuthenticatedAppShell } from "@/app/shells/AuthenticatedAppShell";
import { PublicShell } from "@/app/shells/PublicShell";
import { AuthPage } from "@/features/auth/AuthPage";
import { SettingsPage } from "@/features/auth/SettingsPage";
import { BlogRoute } from "@/features/blog/BlogRoute";
import { PostEditorRoute } from "@/features/blog/PostEditorRoute";
import { EditorRoute } from "@/features/editor/EditorRoute";
import { MediaRoute } from "@/features/media/MediaRoute";
import { CmsRoute } from "@/features/cms/CmsRoute";
import { DomainsRoute } from "@/features/publishing/DomainsRoute";
import { PublishRoute } from "@/features/publishing/PublishRoute";
import { SiteDashboardRoute } from "@/features/sites/SiteDashboardRoute";
import { PreviewRoute } from "@/features/preview/PreviewRoute";
import { SitesPage } from "@/features/projects/SitesPage";
import { LandingPage } from "@/features/public/LandingPage";
import { NotFoundPage } from "@/features/public/NotFoundPage";
import { RoadmapPage } from "@/features/public/RoadmapPage";
import { safeReturnPath } from "@/lib/return-path";

/**
 * Route families are `/`, `/roadmap`, `/login`, `/signup`, `/app/*` and `/api/*` on one origin.
 *
 * `PublicShell` and `AuthenticatedAppShell` are sibling layout routes, never nested and never
 * conditional inside one another, so only one left navigation can be mounted at a time. Preview
 * mounts neither.
 */
function RequireAuthenticatedArea() {
  const location = useLocation();
  const returnTo = safeReturnPath(`${location.pathname}${location.search}`);
  return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
}

function SitesRoute() {
  const { workspaceId } = useParams();
  // The route cannot match without the segment; the server verifies membership regardless.
  return <SitesPage workspaceId={workspaceId ?? ""} />;
}

function PreviewRouteWithWorkspace({ workspaceId }: { workspaceId: string }) {
  return <PreviewRoute workspaceId={workspaceId} />;
}

export function AppRoutes({
  authenticated = false,
  previewWorkspaceId = "",
}: { authenticated?: boolean; previewWorkspaceId?: string } = {}) {
  return (
    <Routes>
      {/* The builder owns the full viewport, so it is declared before the shell's nested routes. */}
      {authenticated && (
        <>
          <Route path="app/:workspaceId/sites/:projectId/builder" element={<EditorRoute />} />
          <Route path="app/:workspaceId/sites/:projectId/builder/:pageId" element={<EditorRoute />} />
        </>
      )}

      {authenticated ? (
        <Route path="app/:workspaceId" element={<AuthenticatedAppShell />}>
          <Route index element={<Navigate to="sites" replace />} />
          <Route path="sites" element={<SitesRoute />} />
          <Route path="sites/:projectId/dashboard" element={<SiteDashboardRoute />} />
          <Route path="sites/:projectId/cms" element={<CmsRoute />} />
          <Route path="sites/:projectId/publish" element={<PublishRoute />} />
          <Route path="sites/:projectId/settings/domains" element={<DomainsRoute />} />
          <Route path="sites/:projectId/blog" element={<BlogRoute />} />
          <Route path="sites/:projectId/blog/posts/new" element={<PostEditorRoute />} />
          <Route path="sites/:projectId/blog/posts/:postId/edit" element={<PostEditorRoute />} />
          <Route path="media" element={<MediaRoute />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      ) : (
        <Route path="app/:workspaceId" element={<RequireAuthenticatedArea />} />
      )}

      <Route path="app/*" element={<RequireAuthenticatedArea />} />

      {/* Preview mounts neither shell: it is a clean rendering of the saved document. */}
      <Route path="preview/:projectId/*" element={<PreviewRouteWithWorkspace workspaceId={previewWorkspaceId} />} />
      <Route path="preview/:projectId" element={<PreviewRouteWithWorkspace workspaceId={previewWorkspaceId} />} />

      <Route element={<PublicShell authenticated={authenticated} />}>
        <Route index element={<LandingPage />} />
        <Route path="roadmap" element={<RoadmapPage />} />
        <Route path="login" element={<AuthPage mode="login" />} />
        <Route path="signup" element={<AuthPage mode="signup" />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
