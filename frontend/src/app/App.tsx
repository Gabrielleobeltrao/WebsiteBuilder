import { useTranslation } from "react-i18next";

import { AppRoutes } from "@/app/routes";
import { useSession } from "@/features/auth/authClient";
import { useAccountLocale } from "@/features/auth/useAccountLocale";

/**
 * Resolves the session once and drives both the route tree and the locale reconciliation from it.
 *
 * The authenticated flag only decides what is rendered. It grants nothing: every request is
 * authorised again on the server against real membership records.
 */
export function App() {
  const { t } = useTranslation("common");
  const session = useSession();
  const authenticated = Boolean(session.data?.user);

  useAccountLocale(authenticated);

  if (session.isPending) {
    return (
      <p role="status" className="p-10 text-center text-ink-500">
        {t("state.loading")}
      </p>
    );
  }

  const previewWorkspaceId = session.data?.session?.activeOrganizationId ?? "";

  return <AppRoutes authenticated={authenticated} previewWorkspaceId={previewWorkspaceId} />;
}
