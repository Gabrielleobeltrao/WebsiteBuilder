import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation, useParams, useSearchParams } from "react-router";

import { AuthenticatedAppShell } from "@/app/shells/AuthenticatedAppShell";
import { PublicShell } from "@/app/shells/PublicShell";
import { AuthPage } from "@/features/auth/AuthPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { SettingsPage } from "@/features/auth/SettingsPage";
import { WorkspaceEntryRoute } from "@/features/workspaces/WorkspaceEntryRoute";
import { SitesPage } from "@/features/projects/SitesPage";
import { LandingPage } from "@/features/public/LandingPage";
import { NotFoundPage } from "@/features/public/NotFoundPage";
import { RoadmapPage } from "@/features/public/RoadmapPage";
import { safeReturnPath } from "@/lib/return-path";

/**
 * Everything behind a deliberate click is fetched at that click.
 *
 * The builder carries the canvas, the drag layer, the rich-text editor and the chart library, and
 * none of it is needed to render a dashboard, a login form or the landing page. Loading it eagerly
 * charged every first visit for a screen most visits never open. Each of these is its own chunk,
 * requested when its route matches.
 */
const AnalyticsRoute = lazy(async () => ({ default: (await import("@/features/analytics/AnalyticsRoute")).AnalyticsRoute }));
const BlogRoute = lazy(async () => ({ default: (await import("@/features/blog/BlogRoute")).BlogRoute }));
const PostEditorRoute = lazy(async () => ({ default: (await import("@/features/blog/PostEditorRoute")).PostEditorRoute }));
const EditorRoute = lazy(async () => ({ default: (await import("@/features/editor/EditorRoute")).EditorRoute }));
const MediaRoute = lazy(async () => ({ default: (await import("@/features/media/MediaRoute")).MediaRoute }));
const CmsRoute = lazy(async () => ({ default: (await import("@/features/cms/CmsRoute")).CmsRoute }));
const DomainsRoute = lazy(async () => ({ default: (await import("@/features/publishing/DomainsRoute")).DomainsRoute }));
const PublishRoute = lazy(async () => ({ default: (await import("@/features/publishing/PublishRoute")).PublishRoute }));
const SiteDashboardRoute = lazy(async () => ({ default: (await import("@/features/sites/SiteDashboardRoute")).SiteDashboardRoute }));
const PreviewRoute = lazy(async () => ({ default: (await import("@/features/preview/PreviewRoute")).PreviewRoute }));

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

/** Sends an already-authenticated visitor to wherever they were heading. */
function ReturnToDestination() {
  const [searchParams] = useSearchParams();
  return <Navigate to={safeReturnPath(searchParams.get("returnTo"))} replace />;
}

function SitesRoute() {
  const { workspaceId } = useParams();
  // The route cannot match without the segment; the server verifies membership regardless.
  return <SitesPage workspaceId={workspaceId ?? ""} />;
}

function OverviewRoute() {
  const { workspaceId } = useParams();
  return <DashboardPage workspaceId={workspaceId ?? ""} />;
}



/**
 * What is shown while a route's code is on its way.
 *
 * A status role rather than a spinner alone: a screen reader announces it, and a person on a slow
 * connection is told the page is loading rather than left with a blank frame.
 */
function RouteFallback() {
  return <p role="status" className="p-10 text-center text-sm text-ink-500" />;
}

export function AppRoutes({ authenticated = false }: { authenticated?: boolean } = {}) {
  return (
    <Suspense fallback={<RouteFallback />}>
    <Routes>
      {/* The builder owns the full viewport, so it is declared before the shell's nested routes. */}
      {authenticated && (
        <>
          <Route path="app/:workspaceId/sites/:projectId/builder" element={<EditorRoute />} />
          <Route path="app/:workspaceId/sites/:projectId/builder/:pageId" element={<EditorRoute />} />
        </>
      )}

      {/*
        `/app` itself needs a route. Without one it fell through to the catch-all below and was sent
        to login, which returned the visitor to `/app` — the default return path — and round again.
      */}
      {authenticated ? (
        <>
        <Route path="app" element={<WorkspaceEntryRoute />} />

        <Route path="app/:workspaceId" element={<AuthenticatedAppShell />}>
          {/* The overview is where a workspace opens: what happened is the first question, and the
              site list is one click away in the navigation. */}
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<OverviewRoute />} />
          <Route path="sites" element={<SitesRoute />} />
          <Route path="sites/:projectId/dashboard" element={<SiteDashboardRoute />} />
          <Route path="sites/:projectId/cms" element={<CmsRoute />} />
          <Route path="sites/:projectId/analytics" element={<AnalyticsRoute />} />
          <Route path="sites/:projectId/publish" element={<PublishRoute />} />
          <Route path="sites/:projectId/settings/domains" element={<DomainsRoute />} />
          <Route path="sites/:projectId/blog" element={<BlogRoute />} />
          <Route path="sites/:projectId/blog/posts/new" element={<PostEditorRoute />} />
          <Route path="sites/:projectId/blog/posts/:postId/edit" element={<PostEditorRoute />} />
          <Route path="media" element={<MediaRoute />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        </>
      ) : (
        <Route path="app/:workspaceId" element={<RequireAuthenticatedArea />} />
      )}

      <Route path="app/*" element={<RequireAuthenticatedArea />} />

      {/*
        Preview mounts neither shell: it is a clean rendering of the saved document.

        The workspace is in the path, like every other business route. It used to be read from the
        session's active organisation, which nothing in this application ever set — so the preview
        asked the API for `/workspaces//projects/…` and got a 404 for every user, every time.
      */}
      <Route path="preview/:workspaceId/:projectId/*" element={<PreviewRoute />} />
      <Route path="preview/:workspaceId/:projectId" element={<PreviewRoute />} />

      <Route element={<PublicShell authenticated={authenticated} />}>
        <Route index element={<LandingPage />} />
        <Route path="roadmap" element={<RoadmapPage />} />
        {/*
          Someone who already has a session never sees a login form. This also closes a race: after
          signing up, the redirect fires before the session hook has refreshed, so `/app` briefly
          looked unauthenticated and sent the new account straight back here.
        */}
        <Route
          path="login"
          element={authenticated ? <ReturnToDestination /> : <AuthPage mode="login" />}
        />
        <Route
          path="signup"
          element={authenticated ? <ReturnToDestination /> : <AuthPage mode="signup" />}
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
    </Suspense>
  );
}
