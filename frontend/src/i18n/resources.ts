import enAuth from "./locales/en-US/auth";
import enBlog from "./locales/en-US/blog";
import enBuilder from "./locales/en-US/builder";
import enCommon from "./locales/en-US/common";
import enDashboard from "./locales/en-US/dashboard";
import enErrors from "./locales/en-US/errors";
import enPublic from "./locales/en-US/public";
import enPublishing from "./locales/en-US/publishing";
import ptAuth from "./locales/pt-BR/auth";
import ptBlog from "./locales/pt-BR/blog";
import ptBuilder from "./locales/pt-BR/builder";
import ptCommon from "./locales/pt-BR/common";
import ptDashboard from "./locales/pt-BR/dashboard";
import ptErrors from "./locales/pt-BR/errors";
import ptPublic from "./locales/pt-BR/public";
import ptPublishing from "./locales/pt-BR/publishing";

/**
 * Namespaces are split by feature so a route loads the copy it needs. English is the source of
 * truth for keys; `pt-BR` is typed against it, which turns a missing translation into a compile
 * error rather than an English string leaking into a Portuguese screen.
 */
export const resources = {
  "en-US": { common: enCommon, public: enPublic, dashboard: enDashboard, builder: enBuilder, auth: enAuth, blog: enBlog, publishing: enPublishing, errors: enErrors },
  "pt-BR": { common: ptCommon, public: ptPublic, dashboard: ptDashboard, builder: ptBuilder, auth: ptAuth, blog: ptBlog, publishing: ptPublishing, errors: ptErrors },
} as const;

export const NAMESPACES = ["common", "public", "dashboard", "builder", "auth", "blog", "publishing", "errors"] as const;
export type Namespace = (typeof NAMESPACES)[number];
export const DEFAULT_NAMESPACE: Namespace = "common";
