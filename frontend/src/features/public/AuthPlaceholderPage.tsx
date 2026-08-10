import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { PageMetadata } from "@/components/common/PageMetadata";

/**
 * Route placeholder for /login and /signup during the foundation phase.
 *
 * Phase 7 replaces the body with the real Better Auth flow. It is a real route rather than a dead
 * link so the public shell's navigation contract is already exercised and tested.
 */
export function AuthPlaceholderPage({ mode }: { mode: "login" | "signup" }) {
  const { t } = useTranslation(["public", "common"]);
  const title = mode === "login" ? t("common:actions.login") : t("common:actions.signup");

  return (
    <div className="px-6 py-16 sm:px-10 lg:px-16">
      <PageMetadata title={`${title} — ${t("common:productName")}`} />
      <div className="mx-auto max-w-md">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-950">{title}</h1>
        <div className="mt-6 rounded-xl border border-ink-200 bg-ink-50 p-6">
          <h2 className="font-medium text-ink-900">{t("public:auth.placeholderTitle")}</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-600">{t("public:auth.placeholderDescription")}</p>
        </div>
        <Link to="/" className="mt-6 inline-block text-sm font-semibold text-accent-700 underline underline-offset-4">
          {t("public:auth.backHome")}
        </Link>
      </div>
    </div>
  );
}
