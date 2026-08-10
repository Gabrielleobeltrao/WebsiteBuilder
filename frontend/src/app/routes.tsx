import { Navigate, Outlet, Route, Routes, useLocation, useParams } from "react-router";

import { PublicShell } from "@/app/shells/PublicShell";
import { SitesPage } from "@/features/projects/SitesPage";
import { AuthPlaceholderPage } from "@/features/public/AuthPlaceholderPage";
import { LandingPage } from "@/features/public/LandingPage";
import { NotFoundPage } from "@/features/public/NotFoundPage";
import { RoadmapPage } from "@/features/public/RoadmapPage";
import { safeReturnPath } from "@/lib/return-path";

/**
 * Route families are `/`, `/roadmap`, `/login`, `/signup`, `/app/*` and `/api/*` on one origin.
 *
 * `/app/*` is declared outside the public layout so the two shells can never be mounted together.
 * The permanent authenticated sidebar arrives in Phase 11; until then the area is a bare outlet.
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

export function AppRoutes({ authenticated = false }: { authenticated?: boolean } = {}) {
  return (
    <Routes>
      <Route path="app/:workspaceId" element={authenticated ? <Outlet /> : <RequireAuthenticatedArea />}>
        <Route index element={<Navigate to="sites" replace />} />
        <Route path="sites" element={<SitesRoute />} />
      </Route>
      <Route path="app/*" element={<RequireAuthenticatedArea />} />

      <Route element={<PublicShell authenticated={authenticated} />}>
        <Route index element={<LandingPage />} />
        <Route path="roadmap" element={<RoadmapPage />} />
        <Route path="login" element={<AuthPlaceholderPage mode="login" />} />
        <Route path="signup" element={<AuthPlaceholderPage mode="signup" />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
