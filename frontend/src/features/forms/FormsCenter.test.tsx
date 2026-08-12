import type { FormSummary, SubmissionPage } from "@websitebuilder/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FormEditor } from "@/features/forms/FormEditor";
import { FormsOverview } from "@/features/forms/FormsOverview";
import { SubmissionsInbox } from "@/features/forms/SubmissionsInbox";
import { renderWithProviders } from "@/test/render";

/**
 * The Forms Center, from the outside.
 *
 * What is asserted here is what makes the module usable rather than merely present: every number is
 * a destination, a stale save is shown rather than silently applied, and a bulk delete asks before
 * it happens.
 */
const BASE = "/app/w1/sites/p1/forms";

const summary = (overrides: Partial<FormSummary> = {}): FormSummary => ({
  id: "f1",
  workspaceId: "w1",
  projectId: "p1",
  name: "Contact",
  fields: [{ id: "name", type: "shortText", label: "Your name", required: true }],
  submitLabel: "Send",
  successBehavior: { type: "message", message: "Thanks" },
  notificationRecipients: [],
  status: "ready",
  archived: false,
  revision: 1,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
  submissionCount: 3,
  unreadCount: 2,
  lastSubmissionAt: "2026-08-11T00:00:00.000Z",
  usages: [],
  ...overrides,
});

const page = (overrides: Partial<SubmissionPage> = {}): SubmissionPage => ({
  items: [],
  total: 0,
  page: 1,
  perPage: 25,
  counts: { new: 0, read: 0, archived: 0, spam: 0, total: 0 },
  ...overrides,
});

type Route = { url: RegExp; method?: string; data: unknown; status?: number };

/** One fetch stub that answers by URL and method, so a screen making several requests is exercised whole. */
function stubApi(routes: Route[]) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });

      for (const route of routes) {
        if (!route.url.test(url)) continue;
        if (route.method !== undefined && route.method !== (init?.method ?? "GET")) continue;

        const status = route.status ?? 200;
        return new Response(JSON.stringify(status >= 400 ? route.data : { data: route.data }), {
          status,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "no stub" } }), { status: 404 });
    }),
  );

  return calls;
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the forms overview", () => {
  it("turns every count into somewhere to go", async () => {
    stubApi([{ url: /\/forms$/, data: [summary({ usages: [{ formId: "f1", pageId: "home", pageName: "Home", path: "/", sectionId: "s1", elementId: "b1", shared: false }] })] }]);

    renderWithProviders(<FormsOverview workspaceId="w1" projectId="p1" basePath={BASE} />);

    const row = await screen.findByRole("row", { name: /Contact/ });
    expect(within(row).getByRole("link", { name: "Home" })).toHaveAttribute(
      "href",
      "/app/w1/sites/p1/builder/home?element=b1",
    );
    expect(within(row).getByRole("link", { name: "3" })).toHaveAttribute("href", `${BASE}/submissions?formId=f1`);
    expect(within(row).getByRole("link", { name: "2 new" })).toHaveAttribute(
      "href",
      `${BASE}/submissions?formId=f1&status=new`,
    );
  });

  it("says a form is on no page rather than showing an empty cell", async () => {
    stubApi([{ url: /\/forms$/, data: [summary()] }]);
    renderWithProviders(<FormsOverview workspaceId="w1" projectId="p1" basePath={BASE} />);

    expect(await screen.findByText("No page yet")).toBeInTheDocument();
  });

  it("offers a way in when there is nothing yet", async () => {
    stubApi([{ url: /\/forms$/, data: [] }]);
    renderWithProviders(<FormsOverview workspaceId="w1" projectId="p1" basePath={BASE} />);

    expect(await screen.findByRole("link", { name: "Create a form" })).toHaveAttribute("href", `${BASE}/new`);
  });

  it("asks before deleting", async () => {
    const calls = stubApi([{ url: /\/forms$/, data: [summary()] }]);
    renderWithProviders(<FormsOverview workspaceId="w1" projectId="p1" basePath={BASE} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Delete" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
  });
});

describe("the form editor", () => {
  const project = { id: "p1", pages: [{ id: "home", name: "Home" }] };

  it("edits questions with real controls rather than a JSON field", async () => {
    stubApi([
      { url: /\/projects\/p1$/, data: project },
      { url: /\/forms\/f1$/, data: { ...summary(), usages: [] } },
    ]);

    renderWithProviders(<FormEditor workspaceId="w1" projectId="p1" formId="f1" basePath={BASE} />);
    const user = userEvent.setup();

    expect(await screen.findByDisplayValue("Your name")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add question" }));

    const labels = screen.getAllByLabelText("Question");
    expect(labels).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Remove Your name" })).toBeInTheDocument();
  });

  it("shows the other person's save instead of overwriting it", async () => {
    stubApi([
      { url: /\/projects\/p1$/, data: project },
      { url: /\/forms\/f1$/, method: "PUT", status: 409, data: { error: { code: "REVISION_CONFLICT", message: "stale" } } },
      { url: /\/forms\/f1$/, data: { ...summary(), usages: [] } },
    ]);

    renderWithProviders(<FormEditor workspaceId="w1" projectId="p1" formId="f1" basePath={BASE} />);
    const user = userEvent.setup();

    await screen.findByDisplayValue("Contact");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument());
  });

  it("offers only this site's own pages as a destination after sending", async () => {
    stubApi([
      { url: /\/projects\/p1$/, data: project },
      { url: /\/forms\/f1$/, data: { ...summary(), usages: [] } },
    ]);

    renderWithProviders(<FormEditor workspaceId="w1" projectId="p1" formId="f1" basePath={BASE} />);
    const user = userEvent.setup();

    await screen.findByDisplayValue("Contact");
    await user.click(screen.getByRole("radio", { name: "Open another page" }));

    // A redirect anywhere else is a link a visitor did not click, which is where a form becomes an
    // open redirect.
    const select = screen.getByLabelText("Page");
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual(["Home"]);
  });
});

describe("the submissions inbox", () => {
  const submission = {
    id: "s1",
    workspaceId: "w1",
    projectId: "p1",
    formId: "f1",
    formRevision: 1,
    fields: [{ id: "name", type: "shortText" as const, label: "Your name" }],
    values: { name: "Ana" },
    status: "new" as const,
    createdAt: "2026-08-11T00:00:00.000Z",
  };

  it("reads the questions from the answer, not from the form as it is now", async () => {
    stubApi([
      { url: /-\/submissions/, data: page({ items: [{ ...submission, values: { name: "Ana", budget: "R$ 5" } }], total: 1, counts: { new: 1, read: 0, archived: 0, spam: 0, total: 1 } }) },
      { url: /\/forms$/, data: [summary()] },
    ]);

    renderWithProviders(<SubmissionsInbox workspaceId="w1" projectId="p1" basePath={BASE} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /Ana/ }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Your name")).toBeInTheDocument();
    // A value whose question the form no longer asks is shown and labelled, never dropped.
    expect(within(dialog).getByText("This question is no longer asked")).toBeInTheDocument();
  });

  it("asks before deleting a selection", async () => {
    const calls = stubApi([
      { url: /-\/submissions/, data: page({ items: [submission], total: 1, counts: { new: 1, read: 0, archived: 0, spam: 0, total: 1 } }) },
      { url: /\/forms$/, data: [summary()] },
    ]);

    renderWithProviders(<SubmissionsInbox workspaceId="w1" projectId="p1" basePath={BASE} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("checkbox", { name: "Select this answer" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(calls.some((call) => call.method === "PATCH")).toBe(false);
  });

  it("marks a selection read in one request", async () => {
    const calls = stubApi([
      { url: /-\/submissions/, data: page({ items: [submission], total: 1, counts: { new: 1, read: 0, archived: 0, spam: 0, total: 1 } }) },
      { url: /\/forms$/, data: [summary()] },
    ]);

    renderWithProviders(<SubmissionsInbox workspaceId="w1" projectId="p1" basePath={BASE} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("checkbox", { name: "Select this answer" }));
    await user.click(screen.getByRole("button", { name: "Mark read" }));

    await waitFor(() =>
      expect(calls.some((call) => call.method === "PATCH" && (call.body as { action: string }).action === "read")).toBe(
        true,
      ),
    );
  });

  it("says nothing matched rather than nothing exists when filters are on", async () => {
    stubApi([
      { url: /-\/submissions/, data: page() },
      { url: /\/forms$/, data: [summary()] },
    ]);

    renderWithProviders(<SubmissionsInbox workspaceId="w1" projectId="p1" basePath={BASE} />, {
      route: `${BASE}/submissions?status=spam`,
    });

    expect(await screen.findByText("No answer matches these filters.")).toBeInTheDocument();
  });
});
