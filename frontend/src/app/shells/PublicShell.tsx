import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet } from "react-router";

import { MobileNavDrawer } from "@/app/shells/MobileNavDrawer";
import { LanguageSelector } from "@/components/common/LanguageSelector";

/**
 * Layout for unauthenticated marketing and authentication entry routes.
 *
 * It is a separate route layout from `AuthenticatedAppShell` on purpose: the two navigations have
 * different audiences, permissions and content, and one sidebar full of authentication conditionals
 * is how they end up leaking into each other. Only one left shell is ever mounted.
 */

const NAV_ITEMS = [
  { to: "/", labelKey: "nav.home" as const, end: true },
  { to: "/roadmap", labelKey: "nav.roadmap" as const, end: false },
];

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation("public");
  return (
    <ul className="space-y-1">
      {NAV_ITEMS.map((item) => (
        <li key={item.to}>
          <NavLink
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              [
                "block rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive ? "bg-ink-100 text-ink-900" : "text-ink-600 hover:bg-ink-50 hover:text-ink-900",
              ].join(" ")
            }
          >
            {t(item.labelKey)}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

function AuthActions({ onNavigate, authenticated }: { onNavigate?: () => void; authenticated: boolean }) {
  const { t } = useTranslation("common");
  if (authenticated) {
    return (
      <Link
        to="/app"
        onClick={onNavigate}
        className="block rounded-md bg-accent-600 px-3 py-2 text-center text-sm font-semibold text-white
          hover:bg-accent-700"
      >
        {t("actions.openDashboard")}
      </Link>
    );
  }
  return (
    <div className="space-y-2">
      <Link
        to="/login"
        onClick={onNavigate}
        className="block rounded-md border border-ink-200 px-3 py-2 text-center text-sm font-medium text-ink-700
          hover:border-ink-300 hover:bg-ink-50"
      >
        {t("actions.login")}
      </Link>
      <Link
        to="/signup"
        onClick={onNavigate}
        className="block rounded-md bg-accent-600 px-3 py-2 text-center text-sm font-semibold text-white
          hover:bg-accent-700"
      >
        {t("actions.signup")}
      </Link>
    </div>
  );
}

function Brand({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation("common");
  return (
    <Link to="/" onClick={onNavigate} className="flex items-center gap-2 text-ink-900">
      <span aria-hidden className="grid size-8 place-items-center rounded-lg bg-ink-900 text-sm font-bold text-white">
        W
      </span>
      <span className="font-display text-base font-semibold tracking-tight">{t("productName")}</span>
    </Link>
  );
}

export function PublicShell({ authenticated = false }: { authenticated?: boolean }) {
  const { t } = useTranslation(["common", "public"]);

  const sidebarContent = (onNavigate?: () => void) => (
    <div className="flex h-full flex-col gap-6">
      <Brand onNavigate={onNavigate} />
      <nav aria-label={t("public:nav.label")} className="flex-1">
        <NavItems onNavigate={onNavigate} />
      </nav>
      <div className="space-y-3">
        <AuthActions onNavigate={onNavigate} authenticated={authenticated} />
        <LanguageSelector />
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-white lg:flex">
      <a href="#main-content" className="skip-link">
        {t("common:skipToContent")}
      </a>

      <MobileNavDrawer id="public-drawer" label={t("public:nav.label")} brand={<Brand />}>
        {(close) => sidebarContent(close)}
      </MobileNavDrawer>

      <aside className="hidden w-64 shrink-0 border-r border-ink-100 p-6 lg:block">{sidebarContent()}</aside>

      <main id="main-content" className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
