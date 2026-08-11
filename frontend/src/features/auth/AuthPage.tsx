import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router";

import { PageMetadata } from "@/components/common/PageMetadata";
import { signIn, signUp } from "@/features/auth/authClient";
import { safeReturnPath } from "@/lib/return-path";

/**
 * Login and signup share one component because they differ only by which call they make and
 * whether a name is collected. Two near-identical files drift apart; one with a mode does not.
 */
export function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const { t } = useTranslation(["auth", "common", "errors"]);
  const passwordId = useId();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<{ kind: "idle" } | { kind: "pending" } | { kind: "error"; message: string }>({
    kind: "idle",
  });

  const returnTo = safeReturnPath(searchParams.get("returnTo"));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus({ kind: "pending" });

    const result =
      mode === "signup"
        ? await signUp.email({ email, password, name: name.trim() || email })
        : await signIn.email({ email, password });

    if (result.error) {
      // Provider messages are developer-facing; the user reads localised copy.
      setStatus({ kind: "error", message: t("auth:failed") });
      return;
    }
    setStatus({ kind: "idle" });
    void navigate(returnTo, { replace: true });
  };

  const title = mode === "login" ? t("common:actions.login") : t("common:actions.signup");

  return (
    <div className="px-6 py-16 sm:px-10 lg:px-16">
      <PageMetadata title={`${title} — ${t("common:productName")}`} />
      <div className="mx-auto max-w-sm">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-950">{title}</h1>

        <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
          {mode === "signup" && (
            <label className="block text-sm font-medium text-ink-700">
              {t("auth:name")}
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                className="mt-1 w-full rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
              />
            </label>
          )}

          <label className="block text-sm font-medium text-ink-700">
            {t("auth:email")}
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              className="mt-1 w-full rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
            />
          </label>

          <div>
            {/* The hint is described, not labelled. Inside the label it becomes part of the field's
                accessible name, so a screen reader announces "Password At least 12 characters" as
                the name of the box rather than as guidance about it. */}
            <label htmlFor={passwordId} className="block text-sm font-medium text-ink-700">
              {t("auth:password")}
            </label>
            <input
              id={passwordId}
              type="password"
              required
              minLength={12}
              value={password}
              aria-describedby={`${passwordId}-hint`}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              className="mt-1 w-full rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
            />
            <span id={`${passwordId}-hint`} className="mt-1 block text-xs font-normal text-ink-500">
              {t("auth:passwordHint")}
            </span>
          </div>

          {status.kind === "error" && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              {status.message}
            </p>
          )}

          <button
            type="submit"
            disabled={status.kind === "pending"}
            className="w-full rounded-md bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white
              hover:bg-accent-700 disabled:opacity-50"
          >
            {status.kind === "pending" ? t("auth:submitting") : title}
          </button>
        </form>

        <p className="mt-6 text-sm text-ink-600">
          {mode === "login" ? (
            <Link to="/signup" className="font-semibold text-accent-700 underline underline-offset-4">
              {t("auth:needAccount")}
            </Link>
          ) : (
            <Link to="/login" className="font-semibold text-accent-700 underline underline-offset-4">
              {t("auth:haveAccount")}
            </Link>
          )}
        </p>
      </div>
    </div>
  );
}
