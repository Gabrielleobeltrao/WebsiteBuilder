import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsPage } from "@/features/auth/SettingsPage";
import { renderWithProviders } from "@/test/render";

/**
 * Settings, as a place with account questions in it.
 *
 * It held one language radio group, so "what is my name here", "how do I change my password" and
 * "what else is signed in" had no answer anywhere in the product. Each of these is served by an
 * endpoint the auth library already had — what is checked here is that the screen asks for the
 * right thing and reports honestly when the server refuses.
 */

const updateUser = vi.fn();
const changePassword = vi.fn();
const listSessions = vi.fn();
const revokeOtherSessions = vi.fn();

vi.mock("@/features/auth/authClient", () => ({
  useSession: () => ({ data: { user: { name: "Gabriel", email: "gabriel@example.test" } } }),
  authClient: {
    updateUser: (...args: unknown[]) => updateUser(...args),
    changePassword: (...args: unknown[]) => changePassword(...args),
    listSessions: () => listSessions(),
    revokeOtherSessions: () => revokeOtherSessions(),
  },
}));

beforeEach(() => {
  updateUser.mockResolvedValue({ error: null });
  changePassword.mockResolvedValue({ error: null });
  revokeOtherSessions.mockResolvedValue({ error: null });
  listSessions.mockResolvedValue({
    error: null,
    data: [
      { id: "s1", createdAt: "2026-08-01T10:00:00.000Z", expiresAt: "2026-09-01T10:00:00.000Z", userAgent: "Firefox" },
      { id: "s2", createdAt: "2026-08-10T10:00:00.000Z", expiresAt: "2026-09-10T10:00:00.000Z", userAgent: "" },
    ],
  });
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no network in this test"))));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("your profile", () => {
  it("saves the name the account is known by", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    const name = await screen.findByLabelText("Name");
    expect(name).toHaveValue("Gabriel");

    await user.clear(name);
    await user.type(name, "Gabriel Beltrao");
    await user.click(screen.getByRole("button", { name: "Save name" }));

    expect(updateUser).toHaveBeenCalledWith({ name: "Gabriel Beltrao" });
    expect(await screen.findByRole("status")).toHaveTextContent("Name saved");
  });

  it("shows the e-mail without pretending it can be changed", async () => {
    renderWithProviders(<SettingsPage />);

    // An editable field here would take the change and never apply it: confirming a new address
    // needs a mail provider this deployment does not have.
    const email = await screen.findByLabelText("E-mail");
    expect(email).toHaveValue("gabriel@example.test");
    expect(email).toBeDisabled();
  });
});

describe("your password", () => {
  it("asks for the current one, and ends the other sessions with the change", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await user.type(await screen.findByLabelText("Current password"), "the-old-one-12");
    await user.type(screen.getByLabelText("New password"), "a-much-better-one");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(changePassword).toHaveBeenCalledWith({
      currentPassword: "the-old-one-12",
      newPassword: "a-much-better-one",
      revokeOtherSessions: true,
    });
  });

  it("refuses to submit a password the server would reject anyway", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await user.type(await screen.findByLabelText("Current password"), "the-old-one-12");
    await user.type(screen.getByLabelText("New password"), "short");

    expect(screen.getByRole("button", { name: "Change password" })).toBeDisabled();
  });

  it("says what went wrong instead of reporting success", async () => {
    changePassword.mockResolvedValue({ error: { message: "Password is incorrect" } });
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await user.type(await screen.findByLabelText("Current password"), "wrong-password-x");
    await user.type(screen.getByLabelText("New password"), "a-much-better-one");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Password is incorrect");
  });
});

describe("signed-in devices", () => {
  it("lists them, naming the one it cannot identify rather than showing a blank row", async () => {
    renderWithProviders(<SettingsPage />);

    expect(await screen.findByText("Firefox")).toBeInTheDocument();
    expect(screen.getByText("Unidentified device")).toBeInTheDocument();
  });

  it("ends the others and reloads what is left", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await user.click(await screen.findByRole("button", { name: "End the others" }));

    expect(revokeOtherSessions).toHaveBeenCalled();
    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(2));
  });

  it("offers nothing to end when this is the only device", async () => {
    listSessions.mockResolvedValue({
      error: null,
      data: [{ id: "s1", createdAt: "2026-08-01T10:00:00.000Z", expiresAt: "2026-09-01T10:00:00.000Z", userAgent: "Firefox" }],
    });
    renderWithProviders(<SettingsPage />);

    await waitFor(() => expect(screen.getByRole("button", { name: "End the others" })).toBeDisabled());
  });
});

describe("the sections a person expects to find", () => {
  it("keeps language where it was, below the account", async () => {
    renderWithProviders(<SettingsPage />);

    const headings = (await screen.findAllByRole("heading", { level: 2 })).map((node) => node.textContent);
    expect(headings).toEqual(["Your profile", "Password", "Signed-in devices", "Language"]);
  });
});
