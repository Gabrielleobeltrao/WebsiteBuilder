import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthPage } from "@/features/auth/AuthPage";
import { SettingsPage } from "@/features/auth/SettingsPage";
import { renderWithProviders } from "@/test/render";

const signIn = vi.hoisted(() => vi.fn());
const signUp = vi.hoisted(() => vi.fn());

vi.mock("@/features/auth/authClient", () => ({
  signIn: { email: signIn },
  signUp: { email: signUp },
  signOut: vi.fn(),
  useSession: () => ({ data: null, isPending: false }),
  authClient: {},
}));

beforeEach(() => {
  signIn.mockReset().mockResolvedValue({ error: null });
  signUp.mockReset().mockResolvedValue({ error: null });
});

afterEach(() => vi.unstubAllGlobals());

describe("AuthPage", () => {
  it("labels every field and requires a strong enough password", () => {
    renderWithProviders(<AuthPage mode="signup" />);

    expect(screen.getByLabelText(/Email/)).toBeRequired();
    expect(screen.getByLabelText(/Password/)).toHaveAttribute("minLength", "12");
    expect(screen.getByText("At least 12 characters.")).toBeInTheDocument();
  });

  it("signs a user in with the entered credentials", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AuthPage mode="login" />);

    await user.type(screen.getByLabelText(/Email/), "person@example.com");
    await user.type(screen.getByLabelText(/Password/), "correct-horse-battery");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(signIn).toHaveBeenCalledWith({ email: "person@example.com", password: "correct-horse-battery" });
  });

  it("shows one localized message for a failed attempt, never the provider's text", async () => {
    signIn.mockResolvedValue({ error: { message: "User not found: person@example.com" } });
    const user = userEvent.setup();
    renderWithProviders(<AuthPage mode="login" />);

    await user.type(screen.getByLabelText(/Email/), "person@example.com");
    await user.type(screen.getByLabelText(/Password/), "wrong-password-here");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("That email and password did not match an account.");
    // Telling the user which half was wrong is how account enumeration starts.
    expect(alert.textContent).not.toContain("User not found");
  });

  it("collects a name only when creating an account", () => {
    const { unmount } = renderWithProviders(<AuthPage mode="login" />);
    expect(screen.queryByLabelText("Your name")).toBeNull();
    unmount();

    renderWithProviders(<AuthPage mode="signup" />);
    expect(screen.getByLabelText("Your name")).toBeInTheDocument();
  });

  it("renders in Portuguese", () => {
    renderWithProviders(<AuthPage mode="signup" />, { locale: "pt-BR" });
    expect(screen.getByRole("heading", { level: 1, name: "Criar conta" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Senha/)).toBeInTheDocument();
  });
});

describe("Settings language", () => {
  it("switches the interface immediately and persists the choice", async () => {
    const requests: Array<{ method: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ method: init?.method ?? "GET", body: JSON.parse(String(init?.body ?? "null")) });
        return new Response(JSON.stringify({ data: { locale: "pt-BR" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await user.click(screen.getByLabelText("Português (Brasil)"));

    expect(await screen.findByRole("heading", { level: 1, name: "Configurações" })).toBeInTheDocument();
    await waitFor(() => expect(requests).toContainEqual({ method: "PUT", body: { locale: "pt-BR" } }));
    expect(document.documentElement.lang).toBe("pt-BR");
  });

  it("keeps the local change and says so plainly when saving fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE", message: "down" } }), {
            status: 503,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);
    await user.click(screen.getByLabelText("Português (Brasil)"));

    expect(await screen.findByRole("alert")).toHaveTextContent("apenas neste dispositivo");
    expect(screen.getByRole("heading", { level: 1, name: "Configurações" })).toBeInTheDocument();
  });
});
