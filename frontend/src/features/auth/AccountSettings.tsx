import { useCallback, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { authClient, useSession } from "@/features/auth/authClient";

/**
 * The account, in the one place a person looks for it.
 *
 * Settings held a single language radio group, so the questions people actually arrive with — what
 * is my name here, how do I change my password, what else is signed in — had no answer anywhere in
 * the product. All three are answered by endpoints the auth library already serves; none of them
 * needed a new one.
 *
 * The e-mail address is shown and not editable. Changing it has to be confirmed by e-mail, and this
 * deployment has no mail provider configured, so an editable field would take the change and never
 * apply it. Saying why is better than a control that quietly does nothing.
 */

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string };

/** A session as the auth library reports it. Only what is shown is named. */
type ActiveSession = {
  id: string;
  createdAt: Date | string;
  expiresAt: Date | string;
  userAgent?: string | null | undefined;
};

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-6 rounded-xl border border-ink-200 p-6">
      <h2 id={id} className="font-display text-lg font-semibold text-ink-900">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Feedback({ status, savedLabel }: { status: Status; savedLabel: string }) {
  if (status.kind === "saved") {
    return (
      <p role="status" className="mt-4 text-sm text-accent-800">
        {savedLabel}
      </p>
    );
  }
  if (status.kind === "error") {
    return (
      <p role="alert" className="mt-4 text-sm text-red-800">
        {status.message}
      </p>
    );
  }
  return null;
}

const field = "mt-1 w-full rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900";
const button =
  "mt-4 rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50";

function ProfileSection() {
  const { t } = useTranslation(["auth", "errors"]);
  const { data: session } = useSession();
  const nameId = useId();
  const emailId = useId();

  const [name, setName] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  // Seeded from the session once it arrives, and left alone afterwards so a background refresh
  // cannot overwrite what someone is in the middle of typing.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (seeded || session?.user === undefined) return;
    setName(session.user.name ?? "");
    setSeeded(true);
  }, [seeded, session]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus({ kind: "saving" });
    try {
      const result = await authClient.updateUser({ name: name.trim() });
      setStatus(
        result.error === null || result.error === undefined
          ? { kind: "saved" }
          : { kind: "error", message: result.error.message ?? t("errors:INTERNAL_ERROR") },
      );
    } catch {
      setStatus({ kind: "error", message: t("errors:INTERNAL_ERROR") });
    }
  };

  return (
    <Section id="profile-heading" title={t("auth:account.profile")}>
      <form onSubmit={(event) => void save(event)} className="mt-4">
        <label htmlFor={nameId} className="block text-sm font-medium text-ink-800">
          {t("auth:account.name")}
        </label>
        <input
          id={nameId}
          value={name}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          className={field}
        />

        <label htmlFor={emailId} className="mt-4 block text-sm font-medium text-ink-800">
          {t("auth:account.email")}
        </label>
        <input id={emailId} value={session?.user.email ?? ""} readOnly disabled className={`${field} bg-ink-50`} />
        <p className="mt-1 text-xs text-ink-500">{t("auth:account.emailFixed")}</p>

        <button type="submit" disabled={status.kind === "saving" || name.trim() === ""} className={button}>
          {t("auth:account.saveName")}
        </button>
      </form>
      <Feedback status={status} savedLabel={t("auth:account.nameSaved")} />
    </Section>
  );
}

function PasswordSection() {
  const { t } = useTranslation(["auth", "errors"]);
  const currentId = useId();
  const nextId = useId();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus({ kind: "saving" });

    try {
      const result = await authClient.changePassword({
        currentPassword: current,
        newPassword: next,
        // Everything else signed in with the old password stops being signed in. Someone changing
        // their password is usually doing it because of something they want to end.
        revokeOtherSessions: true,
      });

      if (result.error === null || result.error === undefined) {
        setCurrent("");
        setNext("");
        setStatus({ kind: "saved" });
        return;
      }
      setStatus({ kind: "error", message: result.error.message ?? t("errors:INTERNAL_ERROR") });
    } catch {
      setStatus({ kind: "error", message: t("errors:INTERNAL_ERROR") });
    }
  };

  return (
    <Section id="password-heading" title={t("auth:account.password")}>
      <form onSubmit={(event) => void save(event)} className="mt-4">
        <label htmlFor={currentId} className="block text-sm font-medium text-ink-800">
          {t("auth:account.currentPassword")}
        </label>
        <input
          id={currentId}
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          className={field}
        />

        <label htmlFor={nextId} className="mt-4 block text-sm font-medium text-ink-800">
          {t("auth:account.newPassword")}
        </label>
        <input
          id={nextId}
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          value={next}
          onChange={(event) => setNext(event.target.value)}
          aria-describedby={`${nextId}-hint`}
          className={field}
        />
        <p id={`${nextId}-hint`} className="mt-1 text-xs text-ink-500">
          {t("auth:account.passwordHint", { count: MIN_PASSWORD_LENGTH })}
        </p>

        <button
          type="submit"
          disabled={status.kind === "saving" || current === "" || next.length < MIN_PASSWORD_LENGTH}
          className={button}
        >
          {t("auth:account.savePassword")}
        </button>
      </form>
      <Feedback status={status} savedLabel={t("auth:account.passwordSaved")} />
    </Section>
  );
}

/** Kept in step with the server, which refuses anything shorter. */
const MIN_PASSWORD_LENGTH = 12;

function SessionsSection() {
  const { t, i18n } = useTranslation(["auth", "errors", "common"]);
  const [sessions, setSessions] = useState<ActiveSession[] | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  /*
   * A rejected call is an empty list, never an exception that escapes.
   *
   * This ran unguarded and took the whole Settings screen down with it — so a person whose network
   * blinked, or whose session had just expired, lost their language setting and their password form
   * as well as the device list. One section failing to load is one section's problem.
   */
  const load = useCallback(async () => {
    try {
      const result = await authClient.listSessions();
      setSessions(result.error ? [] : ((result.data ?? []) as ActiveSession[]));
    } catch {
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revokeOthers = async () => {
    setStatus({ kind: "saving" });
    try {
      const result = await authClient.revokeOtherSessions();
      if (result.error === null || result.error === undefined) {
        setStatus({ kind: "saved" });
        await load();
        return;
      }
      setStatus({ kind: "error", message: result.error.message ?? t("errors:INTERNAL_ERROR") });
    } catch {
      setStatus({ kind: "error", message: t("errors:INTERNAL_ERROR") });
    }
  };

  const formatDate = (value: Date | string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

  return (
    <Section id="sessions-heading" title={t("auth:account.sessions")}>
      <p className="mt-2 text-sm text-ink-600">{t("auth:account.sessionsDescription")}</p>

      {sessions === null ? (
        <p role="status" className="mt-4 text-sm text-ink-500">
          {t("common:state.loading")}
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {sessions.map((entry) => (
            <li key={entry.id} className="rounded-lg border border-ink-100 px-4 py-3 text-sm">
              {/* The device string is the browser's own, shown as text and never parsed into a
                  claim the product cannot stand behind. */}
              <p className="truncate text-ink-800">{entry.userAgent || t("auth:account.unknownDevice")}</p>
              <p className="mt-0.5 text-xs text-ink-500">
                {t("auth:account.sessionStarted", { when: formatDate(entry.createdAt) })}
              </p>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => void revokeOthers()}
        disabled={status.kind === "saving" || (sessions?.length ?? 0) < 2}
        className="mt-4 rounded-md border border-ink-200 px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-50"
      >
        {t("auth:account.endOthers")}
      </button>
      <Feedback status={status} savedLabel={t("auth:account.othersEnded")} />
    </Section>
  );
}

export function AccountSettings() {
  return (
    <>
      <ProfileSection />
      <PasswordSection />
      <SessionsSection />
    </>
  );
}
