import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaAsset } from "@/api/media";
import { MediaLibrary } from "@/features/media/MediaLibrary";
import { renderWithProviders } from "@/test/render";

const asset = (overrides: Partial<MediaAsset> = {}): MediaAsset => ({
  id: "aaaaaaaaaaaaaaaaaaaaaaaa",
  workspaceId: "w1",
  originalFilename: "beach.png",
  width: 1600,
  height: 900,
  variants: [
    { width: 320, height: 180, bytes: 8_000, mimeType: "image/webp", storageKey: "k1" },
    { width: 768, height: 432, bytes: 24_000, mimeType: "image/webp", storageKey: "k2" },
    { width: 1440, height: 810, bytes: 60_000, mimeType: "image/webp", storageKey: "k3" },
  ],
  createdAt: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ data }), { status, headers: { "content-type": "application/json" } });

const fail = (code: string, status: number) =>
  new Response(JSON.stringify({ error: { code, message: code } }), {
    status,
    headers: { "content-type": "application/json" },
  });

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("MediaLibrary states", () => {
  it("shows loading, then the grid", async () => {
    mockFetch(() => ok([asset()]));
    renderWithProviders(<MediaLibrary workspaceId="w1" projectId="p1" />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading media…");
    expect(await screen.findByRole("img", { name: "beach.png" })).toBeInTheDocument();
    expect(screen.getByText("beach.png")).toBeInTheDocument();
    expect(screen.getByText(/3 sizes/)).toBeInTheDocument();
  });

  it("shows an empty state rather than a blank grid", async () => {
    mockFetch(() => ok([]));
    renderWithProviders(<MediaLibrary workspaceId="w1" projectId="p1" />);
    expect(await screen.findByRole("heading", { level: 3, name: "No images yet" })).toBeInTheDocument();
  });

  it("shows a localized error with a retry that works", async () => {
    let calls = 0;
    mockFetch(() => {
      calls += 1;
      return calls === 1 ? fail("SERVICE_UNAVAILABLE", 503) : ok([asset()]);
    });
    const user = userEvent.setup();
    renderWithProviders(<MediaLibrary workspaceId="w1" projectId="p1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("temporarily unavailable");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("beach.png")).toBeInTheDocument();
  });
});

describe("responsive delivery", () => {
  it("requests the smallest variant for a thumbnail and offers the rest through srcset", async () => {
    mockFetch(() => ok([asset()]));
    renderWithProviders(<MediaLibrary workspaceId="w1" projectId="p1" />);

    const image = await screen.findByRole("img", { name: "beach.png" });
    expect(image).toHaveAttribute("src", expect.stringContaining("w=320"));
    expect(image.getAttribute("srcset")).toContain("320w");
    expect(image.getAttribute("srcset")).toContain("1440w");
  });

  it("states explicit dimensions so the grid does not shift while loading", async () => {
    mockFetch(() => ok([asset()]));
    renderWithProviders(<MediaLibrary workspaceId="w1" projectId="p1" />);

    const image = await screen.findByRole("img", { name: "beach.png" });
    expect(image).toHaveAttribute("width", "1600");
    expect(image).toHaveAttribute("height", "900");
    expect(image).toHaveAttribute("loading", "lazy");
  });
});

describe("upload", () => {
  it("uploads raw bytes with the filename in a header", async () => {
    const spy = mockFetch((_url, init) => (init?.method === "POST" ? ok(asset(), 201) : ok([])));
    const user = userEvent.setup();
    renderWithProviders(<MediaLibrary workspaceId="w1" projectId="p1" />);
    await screen.findByRole("heading", { level: 3, name: "No images yet" });

    const file = new File([new Uint8Array([1, 2, 3])], "férias.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Upload image"), file);

    await waitFor(() => {
      const post = spy.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
      expect(post).toBeDefined();
      const headers = (post?.[1] as RequestInit).headers as Record<string, string>;
      // Header values must be ISO-8859-1; the accented name is encoded rather than throwing.
      expect(headers["x-filename"]).toBe(encodeURIComponent("férias.png"));
    });
  });

  it("explains a rejected file in the user's language", async () => {
    mockFetch((_url, init) => (init?.method === "POST" ? fail("UNSUPPORTED_MEDIA_TYPE", 415) : ok([])));
    const user = userEvent.setup();
    renderWithProviders(<MediaLibrary workspaceId="w1" projectId="p1" />);
    await screen.findByRole("heading", { level: 3, name: "No images yet" });

    // The real case is a file that claims to be an image: the browser's accept filter lets it
    // through and only the server's byte sniffing catches it.
    await user.upload(
      screen.getByLabelText("Upload image"),
      new File([new Uint8Array([60, 115, 118, 103])], "evil.png", { type: "image/png" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("not a supported image");
  });

  it("explains an oversized file distinctly from an unsupported one", async () => {
    mockFetch((_url, init) => (init?.method === "POST" ? fail("PAYLOAD_TOO_LARGE", 413) : ok([])));
    const user = userEvent.setup();
    renderWithProviders(<MediaLibrary workspaceId="w1" projectId="p1" />);
    await screen.findByRole("heading", { level: 3, name: "No images yet" });

    await user.upload(
      screen.getByLabelText("Upload image"),
      new File([new Uint8Array([1])], "huge.png", { type: "image/png" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("limit is 12 MB");
  });
});

describe("selection and deletion", () => {
  it("offers selection only when the caller wants it", async () => {
    mockFetch(() => ok([asset()]));
    const { unmount } = renderWithProviders(<MediaLibrary workspaceId="w1" projectId="p1" />);
    await screen.findByText("beach.png");
    expect(screen.queryByRole("button", { name: "Use this image" })).toBeNull();
    unmount();

    const onSelect = vi.fn();
    renderWithProviders(<MediaLibrary workspaceId="w1" projectId="p1" onSelect={onSelect} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Use this image" }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: asset().id }));
  });

  it("requires confirmation and states the consequence before deleting", async () => {
    const requests: string[] = [];
    mockFetch((url, init) => {
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return ok(requests.some((r) => r.startsWith("DELETE")) ? [] : [asset()]);
    });

    const user = userEvent.setup();
    renderWithProviders(<MediaLibrary workspaceId="w1" projectId="p1" />);
    await screen.findByText("beach.png");

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete this image?" });
    expect(within(dialog).getByText(/show a placeholder/)).toBeInTheDocument();
    expect(requests.some((r) => r.startsWith("DELETE"))).toBe(false);

    await user.click(within(dialog).getByRole("button", { name: "Delete image" }));
    expect(await screen.findByRole("heading", { level: 3, name: "No images yet" })).toBeInTheDocument();
  });
});

describe("search and localization", () => {
  it("filters by filename and reports no matches", async () => {
    mockFetch(() => ok([asset(), asset({ id: "b", originalFilename: "mountain.png" })]));
    const user = userEvent.setup();
    renderWithProviders(<MediaLibrary workspaceId="w1" projectId="p1" />);
    await screen.findByText("beach.png");

    await user.type(screen.getByLabelText("Search by filename"), "mount");
    expect(screen.queryByText("beach.png")).toBeNull();
    expect(screen.getByText("mountain.png")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Search by filename"));
    await user.type(screen.getByLabelText("Search by filename"), "zzz");
    expect(screen.getByText("No images match that search.")).toBeInTheDocument();
  });

  it("renders in Portuguese including pluralisation", async () => {
    mockFetch(() => ok([asset({ variants: [asset().variants[0]!] })]));
    renderWithProviders(<MediaLibrary workspaceId="w1" projectId="p1" />, { locale: "pt-BR" });

    expect(await screen.findByRole("heading", { level: 2, name: "Mídia" })).toBeInTheDocument();
    expect(screen.getByText(/1 tamanho/)).toBeInTheDocument();
  });
});
