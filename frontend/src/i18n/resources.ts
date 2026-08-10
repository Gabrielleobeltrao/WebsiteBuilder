import enCommon from "./locales/en-US/common";
import enDashboard from "./locales/en-US/dashboard";
import enErrors from "./locales/en-US/errors";
import enPublic from "./locales/en-US/public";
import ptCommon from "./locales/pt-BR/common";
import ptDashboard from "./locales/pt-BR/dashboard";
import ptErrors from "./locales/pt-BR/errors";
import ptPublic from "./locales/pt-BR/public";

/**
 * Namespaces are split by feature so a route loads the copy it needs. English is the source of
 * truth for keys; `pt-BR` is typed against it, which turns a missing translation into a compile
 * error rather than an English string leaking into a Portuguese screen.
 */
export const resources = {
  "en-US": { common: enCommon, public: enPublic, dashboard: enDashboard, errors: enErrors },
  "pt-BR": { common: ptCommon, public: ptPublic, dashboard: ptDashboard, errors: ptErrors },
} as const;

export const NAMESPACES = ["common", "public", "dashboard", "errors"] as const;
export type Namespace = (typeof NAMESPACES)[number];
export const DEFAULT_NAMESPACE: Namespace = "common";
