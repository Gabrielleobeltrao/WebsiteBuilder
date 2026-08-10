import { Navigate, Route, Routes, useLocation } from "react-router";

import { PublicShell } from "@/app/shells/PublicShell";
import { AuthPlaceholderPage } from "@/features/public/AuthPlaceholderPage";
import { LandingPage } from "@/features/public/LandingPage";
import { NotFoundPage } from "@/features/public/NotFoundPage";
import { RoadmapPage } from "@/features/public/RoadmapPage";
import { safeReturnPath } from "@/lib/return-path";

/**
 * Route families are `/`, `/roadmap`, `/login`, `/signup`, `/app/*` and `/api/*` on one origin.
 *
 * `/app/*` is deliberately declared outside the public layout: the authenticated shell arrives in
 * Phase 7 and must never mount the public sidebar. Until it exists, an unauthenticated visit is
 * sent to login carrying a validated internal return path.
 */
function RequireAuthenticatedArea() {
  const location = useLocation();
  const returnTo = safeReturnPath(`${location.pathname}${location.search}`);
  return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
}

export function AppRoutes({ authenticated = false }: { authenticated?: boolean } = {}) {
  return (
    <Routes>
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
