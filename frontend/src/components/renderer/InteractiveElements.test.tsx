import type { AccordionElement, SocialLinksElement, TableElement, TabsElement, VideoElement } from "@websitebuilder/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import {
  AccordionRenderer,
  AnnouncementBarRenderer,
  LightboxRenderer,
  SocialLinksRenderer,
  TableRenderer,
  TabsRenderer,
  VideoRenderer,
} from "./InteractiveElements";

const base = {
  id: "e1",
  name: "Element",
  geometry: { x: 0, y: 0, width: 200, height: 100, rotation: 0 },
  responsiveLayout: {
    width: { value: 200, unit: "px" as const },
    height: { value: 100, unit: "px" as const },
    horizontalConstraint: "left" as const,
    verticalConstraint: "top" as const,
    visible: true,
  },
  zIndex: 1,
  locked: false,
  hidden: false,
};

afterEach(() => {
  try {
    sessionStorage.clear();
  } catch {
    // Nothing stored.
  }
});

describe("accordion", () => {
  const element = (allowMultiple: boolean): AccordionElement =>
    ({
      ...base,
      type: "accordion",
      allowMultiple,
      items: [
        { question: "First", answer: "One" },
        { question: "Second", answer: "Two" },
      ],
    }) as AccordionElement;

  it("is operable from the keyboard, because it is a real disclosure", async () => {
    // jsdom renders `<details>` but does not implement its toggle, so what is asserted here is the
    // structure that gives a browser the behaviour: a focusable summary inside details.
    render(<AccordionRenderer element={element(true)} />);

    await userEvent.tab();
    const summary = screen.getByText("First");

    expect(summary).toHaveFocus();
    expect(summary.tagName).toBe("SUMMARY");
    expect(summary.closest("details")).not.toBeNull();
  });

  it("keeps one panel open at a time when configured that way", () => {
    render(<AccordionRenderer element={element(false)} />);
    const panels = screen.getAllByText(/First|Second/).map((node) => node.closest("details"));

    // The platform's own exclusive group, rather than state this code has to keep correct.
    expect(panels[0]).toHaveAttribute("name");
    expect(panels[0]?.getAttribute("name")).toBe(panels[1]?.getAttribute("name"));
  });

  it("allows several at once when configured that way", () => {
    render(<AccordionRenderer element={element(true)} />);
    expect(screen.getByText("First").closest("details")).not.toHaveAttribute("name");
  });
});

describe("tabs", () => {
  const element: TabsElement = {
    ...base,
    type: "tabs",
    items: [
      { label: "One", content: "First panel" },
      { label: "Two", content: "Second panel" },
      { label: "Three", content: "Third panel" },
    ],
  } as TabsElement;

  it("moves between tabs with the arrow keys", async () => {
    render(<TabsRenderer element={element} />);

    await userEvent.tab();
    expect(screen.getByRole("tab", { name: "One" })).toHaveFocus();

    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Two" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Two" })).toHaveAttribute("aria-selected", "true");
  });

  it("wraps around and jumps to the ends", async () => {
    render(<TabsRenderer element={element} />);

    await userEvent.tab();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Three" })).toHaveFocus();

    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "One" })).toHaveFocus();

    await userEvent.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Three" })).toHaveFocus();
  });

  it("keeps only the active tab in the tab order", () => {
    render(<TabsRenderer element={element} />);

    expect(screen.getByRole("tab", { name: "One" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Two" })).toHaveAttribute("tabindex", "-1");
  });

  it("announces state through aria-selected, not only through colour", async () => {
    render(<TabsRenderer element={element} />);

    await userEvent.click(screen.getByRole("tab", { name: "Two" }));
    expect(screen.getByRole("tab", { name: "Two" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "One" })).toHaveAttribute("aria-selected", "false");
  });

  it("shows only the selected panel and links it to its tab", async () => {
    render(<TabsRenderer element={element} />);

    const panel = screen.getByText("First panel");
    expect(panel).toBeVisible();
    expect(screen.getByText("Second panel")).not.toBeVisible();

    const tab = screen.getByRole("tab", { name: "One" });
    expect(panel).toHaveAttribute("aria-labelledby", tab.id);
  });
});

describe("lightbox", () => {
  const images = [
    { id: "a", src: "/a.webp", alt: "First" },
    { id: "b", src: "/b.webp", alt: "Second" },
  ];

  it("returns focus to the thumbnail that opened it", async () => {
    render(<LightboxRenderer images={images} columns={2} gap={8} />);

    const opener = screen.getAllByRole("button")[0]!;
    await userEvent.click(opener);

    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button"));

    // A keyboard visitor must not land back at the top of the page.
    expect(opener).toHaveFocus();
  });

  it("uses a real dialog, so Escape and the focus trap come from the platform", async () => {
    render(<LightboxRenderer images={images} columns={2} gap={8} />);

    await userEvent.click(screen.getAllByRole("button")[0]!);
    expect(screen.getByRole("dialog").tagName).toBe("DIALOG");
  });
});

describe("announcement bar", () => {
  const props = {
    text: "We are hiring",
    href: null,
    backgroundColor: "#000",
    textColor: "#fff",
    dismissible: true,
    dismissLabel: "Dismiss",
    storageKey: "announce-1",
  };

  it("has a named dismiss control rather than a bare symbol", async () => {
    render(<AnnouncementBarRenderer {...props} />);

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("We are hiring")).not.toBeInTheDocument();
  });

  it("cannot be dismissed when it is not dismissible", () => {
    render(<AnnouncementBarRenderer {...props} dismissible={false} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("video", () => {
  const element: VideoElement = {
    ...base,
    type: "video",
    provider: "youtube",
    videoId: "abc123",
    title: "Product tour",
  } as VideoElement;

  it("loads a URL this code built and names the frame", () => {
    render(<VideoRenderer element={element} />);

    const frame = screen.getByTitle("Product tour");
    expect(frame).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/abc123");
  });

  it("does not grant the player the camera or the microphone", () => {
    render(<VideoRenderer element={element} />);

    const allow = screen.getByTitle("Product tour").getAttribute("allow") ?? "";
    expect(allow).not.toContain("camera");
    expect(allow).not.toContain("microphone");
  });
});

describe("table", () => {
  const element: TableElement = {
    ...base,
    type: "table",
    headers: ["Plan", "Price"],
    rows: [["Basic", "10"]],
    hasHeaderRow: true,
    caption: "Our plans",
  } as TableElement;

  it("can be navigated: a caption, headers and scope", () => {
    render(<TableRenderer element={element} />);

    expect(screen.getByRole("table", { name: "Our plans" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Plan" })).toHaveAttribute("scope", "col");
  });

  it("omits the header row when the document says there is none", () => {
    render(<TableRenderer element={{ ...element, hasHeaderRow: false }} />);
    expect(screen.queryByRole("columnheader")).not.toBeInTheDocument();
  });
});

describe("social links", () => {
  const element: SocialLinksElement = {
    ...base,
    type: "socialLinks",
    items: [{ network: "instagram", url: "https://instagram.com/acme" }],
    iconSize: 24,
    gap: 8,
  } as SocialLinksElement;

  it("names each link, so it is not announced as a bare bullet", () => {
    render(<SocialLinksRenderer element={element} />);
    expect(screen.getByRole("link", { name: "instagram" })).toBeInTheDocument();
  });

  it("opens externally without handing over the opener", () => {
    render(<SocialLinksRenderer element={element} />);

    const link = screen.getByRole("link", { name: "instagram" });
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });
});
