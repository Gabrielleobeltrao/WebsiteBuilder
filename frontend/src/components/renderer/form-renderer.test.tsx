import { DEFAULT_FORM_PRESENTATION, type FormPresentation, type PublishedForm } from "@websitebuilder/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { FormRenderer } from "./FormRenderer";
import { RendererContext, type RendererContextValue } from "./RendererContext";

/**
 * The form block, in every place a page is rendered.
 *
 * It used to render `null`, so the canvas, the preview and the published page all showed nothing
 * where a form was placed. What is asserted here is that the markup is real, works without any
 * JavaScript, and differs between surfaces only in whether it can be operated.
 */
const form = (overrides: Partial<PublishedForm> = {}): PublishedForm => ({
  id: "f1",
  name: "Contact",
  revision: 3,
  fields: [
    { id: "name", type: "shortText", label: "Your name", required: true },
    { id: "email", type: "email", label: "Email", required: true, helpText: "We reply here." },
    { id: "plan", type: "radio", label: "Plan", required: false, options: ["Basic", "Pro"] },
    { id: "consent", type: "consent", label: "I agree", required: true },
    { id: "campaign", type: "hidden", label: "Campaign", required: false },
  ],
  submitLabel: "Send",
  successBehavior: { type: "message", message: "Thank you." },
  status: "ready",
  ...overrides,
});

function draw(
  context: Partial<RendererContextValue> = {},
  presentation: FormPresentation = DEFAULT_FORM_PRESENTATION,
  formId = "f1",
) {
  return render(
    <RendererContext.Provider
      value={{ resolvePagePath: () => null, resolveMediaUrl: () => null, resolveForm: () => form(), ...context }}
    >
      <FormRenderer elementId="block-1" formId={formId} presentation={presentation} />
    </RendererContext.Provider>,
  );
}

describe("a bound form", () => {
  it("renders a real post to the site's own origin", () => {
    const { container } = draw({ formMode: "live", formAction: (id) => `/__wb/forms/${id}/submissions` });
    const element = container.querySelector("form");

    // Native first: this works with the runtime absent, blocked or still loading.
    expect(element).toHaveAttribute("method", "post");
    expect(element).toHaveAttribute("action", "/__wb/forms/f1/submissions");
  });

  it("sends the revision the visitor was actually shown", () => {
    const { container } = draw({ formMode: "live" });
    expect(container.querySelector('input[name="__wb_revision"]')).toHaveValue("3");
  });

  it("carries a honeypot no person can reach", () => {
    const { container } = draw({ formMode: "live" });
    const trap = container.querySelector('input[name="__wb_company"]');

    expect(trap).toHaveAttribute("tabindex", "-1");
    expect(trap?.closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("labels every question and describes the ones with help", () => {
    draw({ formMode: "live" });

    expect(screen.getByLabelText(/Your name/)).toBeRequired();
    const email = screen.getByLabelText(/Email/);
    expect(email).toHaveAttribute("type", "email");
    expect(email.getAttribute("aria-describedby")).not.toBeNull();
  });

  it("groups a set of choices so the question is audible from any option", () => {
    draw({ formMode: "live" });

    const group = screen.getByRole("group", { name: /Plan/ });
    expect(within(group).getAllByRole("radio")).toHaveLength(2);
  });

  it("does not publish a hidden field as an input a visitor sees", () => {
    const { container } = draw({ formMode: "live" });
    expect(container.querySelector('[name="campaign"]')).toBeNull();
  });

  it("says required in words, not only with an asterisk", () => {
    draw({ formMode: "live" });
    expect(screen.getAllByText("(required)").length).toBeGreaterThan(0);
  });
});

describe("on the builder canvas", () => {
  it("shows the real fields and lets none of them be operated", async () => {
    draw({ formMode: "inert" });

    expect(screen.getByLabelText(/Your name/)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();

    // Clicking a field must select the block rather than typing into it.
    await userEvent.click(screen.getByLabelText(/Your name/));
    expect(screen.getByLabelText(/Your name/)).toHaveValue("");
  });

  it("posts nowhere", () => {
    const { container } = draw({ formMode: "inert" });
    expect(container.querySelector("form")).not.toHaveAttribute("action");
  });
});

describe("a block that cannot show a form", () => {
  it("says nothing was chosen", () => {
    draw({ resolveForm: () => null }, DEFAULT_FORM_PRESENTATION, "");
    expect(screen.getByText("Choose which form this block shows.")).toBeInTheDocument();
  });

  it("tells a missing form apart from an unchosen one", () => {
    draw({ resolveForm: () => null });
    expect(screen.getByText("The form this block pointed at no longer exists.")).toBeInTheDocument();
  });

  it("tells an archived form apart from both", () => {
    draw({ resolveForm: () => form({ status: "archived" }) });
    expect(screen.getByText("This form is archived and is not accepting answers.")).toBeInTheDocument();
  });
});

describe("after a no-JavaScript submission", () => {
  it("shows the form's own success message", () => {
    draw({ formMode: "live", formResult: { formId: "f1", state: "ok" } });
    expect(screen.getByRole("status")).toHaveTextContent("Thank you.");
  });

  it("shows an error only for the form that failed", () => {
    draw({ formMode: "live", formResult: { formId: "other", state: "error" } });
    expect(screen.getByRole("alert", { hidden: true })).not.toBeVisible();
  });
});

describe("presentation", () => {
  it("never lets a form push the page sideways", () => {
    const { container } = draw({ formMode: "live" }, { ...DEFAULT_FORM_PRESENTATION, preset: "twoColumn" });
    const element = container.querySelector("form") as HTMLFormElement;

    expect(element.style.maxWidth).toBe("100%");
    expect(element.style.boxSizing).toBe("border-box");
  });

  it("collapses two columns by track width rather than by a media query", () => {
    const { container } = draw({ formMode: "live" }, { ...DEFAULT_FORM_PRESENTATION, preset: "twoColumn" });
    const grid = container.querySelector("form > div:last-of-type") as HTMLElement;

    // `auto-fit` with a `min()` floor is true at every width, including ones nobody tested.
    expect(grid.style.gridTemplateColumns).toContain("auto-fit");
    expect(grid.style.gridTemplateColumns).toContain("min(220px, 100%)");
  });
});
