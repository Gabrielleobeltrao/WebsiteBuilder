import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";

import { safeReturnPath } from "@/lib/return-path";

/**
 * Back to wherever this screen was opened from.
 *
 * Somebody who came here from a form block on a page is not going "back to forms" — they are going
 * back to the block they were placing. The address they return to is re-validated here rather than
 * trusted: it arrives in a query string, which anybody can write, and an unchecked one is an open
 * redirect wearing a Back label.
 */
export function BackLink({ basePath }: { basePath: string }) {
  const { t } = useTranslation("forms");
  const [searchParams] = useSearchParams();

  const requested = searchParams.get("returnTo");
  const returning = requested !== null && requested !== "";
  const to = returning ? safeReturnPath(requested) : basePath;

  return (
    <Link to={to} className="text-sm font-medium text-ink-600 underline underline-offset-4">
      {returning ? t("actions.backToBuilder") : t("actions.back")}
    </Link>
  );
}
