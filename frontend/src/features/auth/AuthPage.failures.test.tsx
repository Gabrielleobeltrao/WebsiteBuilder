import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthPage } from "@/features/auth/AuthPage";
import { renderWithProviders } from "@/test/render";

/**
 * What the visitor is told when it goes wrong. The three cases need different actions, and telling
 * someone creating an account that their credentials did not match one sends them to fix a password
 * that was never involved.
 */
vi.mock("@/features/auth/authClient", () => ({
  signUp: { email: vi.fn() },
  signIn: { email: vi.fn() },
  useSession: () => ({ data: null, isPending: false }),
  signOut: vi.fn(),
  authClient: {},
}));

const { signIn, signUp } = await import("@/features/auth/authClient");

async function submit(mode: "login" | "signup") {
  renderWithProviders(<AuthPage mode={mode} />);

  if (mode === "signup") await userEvent.type(screen.getByLabelText("Your name"), "Test");
  await userEvent.type(screen.getByLabelText("Email"), "person@example.test");
  await userEvent.type(screen.getByLabelText("Password"), "a-long-enough-password");
  await userEvent.click(screen.getByRole("button", { name: /Log in|Sign up|Create/i }));
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("sign-in failures", () => {
  it("says the credentials did not match", async () => {
    vi.mocked(signIn.email).mockResolvedValue({ error: { status: 401, message: "invalid" } } as never);
    await submit("login");

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("That email and password did not match an account."),
    );
  });
});

describe("sign-up failures", () => {
  it("does not blame credentials that were never checked", async () => {
    vi.mocked(signUp.email).mockResolvedValue({ error: { status: 400, message: "bad request" } } as never);
    await submit("signup");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("We could not create the account"));
    expect(screen.getByRole("alert")).not.toHaveTextContent("did not match an account");
  });

  it("points an existing address at logging in instead", async () => {
    vi.mocked(signUp.email).mockResolvedValue({
      error: { status: 422, message: "user already exists" },
    } as never);
    await submit("signup");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Try logging in instead"));
  });
});

describe("unreachable server", () => {
  it("says so plainly instead of sending the visitor to check a password", async () => {
    // The case where nothing the person types will help, and the one that cost the most time to
    // diagnose when it read as a rejected sign-in.
    vi.mocked(signUp.email).mockResolvedValue({ error: { status: 0, message: "Failed to fetch" } } as never);
    await submit("signup");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("could not reach the server"));
    expect(screen.getByRole("alert")).toHaveTextContent("not your password");
  });

  it("treats a server error the same way, because it is also not the visitor's doing", async () => {
    vi.mocked(signIn.email).mockResolvedValue({ error: { status: 502, message: "bad gateway" } } as never);
    await submit("login");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("could not reach the server"));
  });

  it("recognises a transport failure by its message when no status is reported", async () => {
    vi.mocked(signIn.email).mockResolvedValue({ error: { message: "Failed to fetch" } } as never);
    await submit("login");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("could not reach the server"));
  });

  it("does not call a rejected credential an outage just because no status came back", async () => {
    // The worse mistake of the two: telling someone nothing they do will help, when retyping would.
    vi.mocked(signIn.email).mockResolvedValue({ error: { message: "User not found" } } as never);
    await submit("login");

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("did not match an account"),
    );
  });
});

describe("rate limiting", () => {
  it("says to wait, not to check the address", async () => {
    // The generic failure told someone to check an address that was never the problem, and acting
    // on that advice means retrying immediately — the one thing that extends the block.
    vi.mocked(signUp.email).mockResolvedValue({
      error: { status: 429, message: "Too many requests. Please try again later." },
    } as never);
    await submit("signup");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Too many attempts"));
    expect(screen.getByRole("alert")).not.toHaveTextContent("Check the address");
  });

  it("says the same when signing in, because the limit is not about which form was used", async () => {
    vi.mocked(signIn.email).mockResolvedValue({ error: { status: 429, message: "Too many requests" } } as never);
    await submit("login");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Too many attempts"));
  });
});

describe("what the server can explain itself", () => {
  it("repeats a password-length rejection instead of guessing", async () => {
    vi.mocked(signUp.email).mockResolvedValue({
      error: { status: 400, message: "Password too short" },
    } as never);
    await submit("signup");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("at least 12 characters"));
  });

  it("points at the address when the address is what was refused", async () => {
    vi.mocked(signUp.email).mockResolvedValue({
      error: { status: 400, message: "[body.email] Invalid email address" },
    } as never);
    await submit("signup");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("does not look right"));
  });
});
