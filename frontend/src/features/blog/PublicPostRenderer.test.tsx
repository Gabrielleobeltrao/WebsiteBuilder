import { createPage, EMPTY_RICH_TEXT, type BlogFieldDefinition, type PostSample } from "@websitebuilder/shared";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RendererContext, type RendererContextValue } from "@/components/renderer/RendererContext";
import { BoundValue, PublicPostRenderer, RichTextView } from "@/features/blog/PublicPostRenderer";
import { renderWithProviders } from "@/test/render";

const context: RendererContextValue = {
  resolvePagePath: () => null,
  resolveMediaUrl: (mediaId) => (mediaId === "m1" ? "/api/v1/media/m1/content" : null),
};

const field = (overrides: Partial<BlogFieldDefinition> = {}): BlogFieldDefinition => ({
  id: "f1",
  key: "subtitle",
  label: "Subtitle",
  type: "shortText",
  required: false,
  ...overrides,
});

const post = (overrides: Partial<PostSample> = {}): PostSample => ({
  title: "Release notes",
  excerpt: "What changed",
  content: EMPTY_RICH_TEXT,
  categoryIds: [],
  customFieldValues: { f1: "A subtitle" },
  ...overrides,
});

const withContext = (ui: React.ReactElement, locale?: "pt-BR" | "en-US") =>
  renderWithProviders(<RendererContext.Provider value={context}>{ui}</RendererContext.Provider>, {
    ...(locale ? { locale } : {}),
  });

describe("BoundValue", () => {
  it("renders a resolved custom field", () => {
    withContext(<BoundValue binding={{ source: "custom", fieldId: "f1" }} post={post()} fieldDefinitions={[field()]} />);
    expect(screen.getByText("A subtitle")).toBeInTheDocument();
  });

  it("flags a binding whose field was removed rather than rendering a blank", () => {
    withContext(<BoundValue binding={{ source: "custom", fieldId: "f1" }} post={post()} fieldDefinitions={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("This field no longer exists");
  });

  it("renders nothing for an empty value, so the layout does not carry a gap", () => {
    const { container } = withContext(
      <BoundValue binding={{ source: "system", field: "author" }} post={post()} fieldDefinitions={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a media binding through the resolver", () => {
    withContext(
      <BoundValue
        binding={{ source: "system", field: "cover" }}
        post={post({ coverMediaId: "m1" })}
        fieldDefinitions={[]}
      />,
    );
    expect(screen.getByRole("presentation")).toHaveAttribute("src", "/api/v1/media/m1/content");
  });

  it("renders a date as a machine-readable time element", () => {
    const { container } = withContext(
      <BoundValue
        binding={{ source: "system", field: "publishedAt" }}
        post={post({ publishedAt: "2026-08-02T00:00:00.000Z" })}
        fieldDefinitions={[]}
      />,
    );
    expect(container.querySelector("time")).toHaveAttribute("datetime", "2026-08-02T00:00:00.000Z");
  });

  it("localizes the missing-field warning", () => {
    withContext(
      <BoundValue binding={{ source: "custom", fieldId: "f1" }} post={post()} fieldDefinitions={[]} />,
      "pt-BR",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Este campo não existe mais");
  });
});

describe("RichTextView", () => {
  it("renders structured content as elements", () => {
    const document = {
      type: "doc",
      content: [
        { type: "heading", content: [{ type: "text", text: "Title" }] },
        { type: "paragraph", content: [{ type: "text", text: "Body" }] },
      ],
    };
    const { container } = withContext(<RichTextView document={document} />);

    expect(container.querySelector("h2")).toHaveTextContent("Title");
    expect(container.querySelector("p")).toHaveTextContent("Body");
  });

  it("renders markup inside text as literal characters, never as HTML", () => {
    const document = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "<img src=x onerror=alert(1)>" }] }],
    };
    const { container } = withContext(<RichTextView document={document} />);

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
  });

  it("renders an unknown node's children rather than emitting the node", () => {
    const document = {
      type: "doc",
      content: [{ type: "iframe", content: [{ type: "text", text: "inner" }] }],
    };
    const { container } = withContext(<RichTextView document={document} />);

    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByText("inner")).toBeInTheDocument();
  });

  it("renders nothing for an absent document", () => {
    const { container } = withContext(<RichTextView document={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("PublicPostRenderer", () => {
  it("renders the published template and the post's own values", () => {
    withContext(
      <PublicPostRenderer
        template={createPage({ name: "Article", isHome: false, slug: "article" })}
        post={post()}
        fieldDefinitions={[field()]}
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Release notes" })).toBeInTheDocument();
    expect(screen.getByText("What changed")).toBeInTheDocument();
  });

  it("is one article element, so assistive technology sees a single document", () => {
    const { container } = withContext(
      <PublicPostRenderer
        template={createPage({ name: "Article", isHome: false, slug: "article" })}
        post={post()}
        fieldDefinitions={[]}
      />,
    );
    expect(container.querySelectorAll("article")).toHaveLength(1);
  });
});
