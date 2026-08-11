import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createI18n } from "@/i18n";
import { useAccountLocale } from "@/features/auth/useAccountLocale";

/**
 * The hook reads `useTranslation()`, so these render it inside a provider carrying a real i18n
 * instance and assert on that instance's language.
 */
import { I18nextProvider } from "react-i18next";
import type { ReactNode } from "react";

function harness(instance: ReturnType<typeof createI18n>) {
  return ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={instance}>{children}</I18nextProvider>
  );
}

/** A preferences response that resolves only when released. */
function deferred<T>() {
  let release: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const jsonResponse = (data: unknown) =>
  new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });

describe("account locale", () => {
  it("applies the language saved on the account", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ locale: "pt-BR" })));

    const instance = createI18n("en-US");
    renderHook(() => useAccountLocale(true), { wrapper: harness(instance) });

    await waitFor(() => expect(instance.language).toBe("pt-BR"));
  });

  it("does nothing without a session", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const instance = createI18n("en-US");
    renderHook(() => useAccountLocale(false), { wrapper: harness(instance) });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not revert a language the user changed while the read was in flight", async () => {
    // Otherwise switching the language right after a page loads flips back on its own, which reads
    // as the product refusing the choice.
    const pending = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => pending.promise));

    const instance = createI18n("en-US");
    renderHook(() => useAccountLocale(true), { wrapper: harness(instance) });

    await instance.changeLanguage("pt-BR");
    pending.release(jsonResponse({ locale: "en-US" }));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(instance.language).toBe("pt-BR");
  });

  it("keeps the local language when the read fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));

    const instance = createI18n("pt-BR");
    renderHook(() => useAccountLocale(true), { wrapper: harness(instance) });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(instance.language).toBe("pt-BR");
  });
});
