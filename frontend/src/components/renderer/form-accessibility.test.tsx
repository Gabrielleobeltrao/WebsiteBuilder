import { DEFAULT_FORM_PRESENTATION, type PublishedForm } from "@websitebuilder/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { FormRenderer } from "./FormRenderer";
import { RendererContext } from "./RendererContext";

/**
 * A generated form, operated by keyboard and read by a screen reader.
 *
 * These are the properties somebody filling one in with no mouse and no sight depends on. They are
 * asserted structurally rather than by an automated audit, because an audit tool reports the
 * absence of an attribute; what matters here is that the *question* reaches the person, which is a
 * relationship between elements rather than a property of one.
 */
const form: PublishedForm = {
  id: "f1",
  name: "Contact",
  revision: 1,
  fields: [
    { id: "name", type: "shortText", label: "Your name", required: true, helpText: "As you would like to be called." },
    { id: "email", type: "email", label: "Email", required: true },
    { id: "message", type: "longText", label: "Message", required: false },
    { id: "plan", type: "radio", label: "Which plan", required: true, options: ["Basic", "Pro"] },
    { id: "topic", type: "select", label: "Topic", required: false, options: ["Sales", "Support"] },
    { id: "consent", type: "consent", label: "I agree to be contacted", required: true },
  ],
  submitLabel: "Send",
  successBehavior: { type: "message", message: "Thank you." },
  status: "ready",
};

function draw() {
  return render(
    <RendererContext.Provider
      value={{
        resolvePagePath: () => null,
        resolveMediaUrl: () => null,
        resolveForm: () => form,
        formMode: "live",
        formAction: () => "/__wb/forms/f1/submissions",
      }}
    >
      <FormRenderer elementId="block-1" formId="f1" presentation={DEFAULT_FORM_PRESENTATION} />
    </RendererContext.Provider>,
  );
}

describe("every control is named by its question", () => {
  it("pairs each field with a label that points at it", () => {
    const { container } = draw();

    for (const control of container.querySelectorAll("input, textarea, select")) {
      if (control.getAttribute("type") === "hidden") continue;
      const id = control.getAttribute("id");
      expect(id, control.outerHTML).not.toBeNull();

      // A placeholder is not a label: it disappears the moment somebody types.
      const label = container.querySelector(`label[for="${id}"]`);
      const inGroup = control.closest("fieldset") !== null;
      expect(label !== null || inGroup, `${id} has no label`).toBe(true);
    }
  });

  it("asks a set of choices as one question rather than as loose buttons", () => {
    draw();
    const group = screen.getByRole("group", { name: /Which plan/ });
    expect(within(group).getAllByRole("radio")).toHaveLength(2);
  });

  it("attaches help text to the control it explains", () => {
    const { container } = draw();
    const control = screen.getByLabelText(/Your name/);
    const describedBy = control.getAttribute("aria-describedby");

    expect(describedBy).not.toBeNull();
    expect(container.querySelector(`#${describedBy}`)?.textContent).toBe("As you would like to be called.");
  });

  it("says required in words as well as in the attribute", () => {
    draw();
    // An asterisk is a convention somebody has to already know, and a screen reader reads it as
    // "star" or skips it entirely.
    expect(screen.getAllByText("(required)").length).toBe(4);
    expect(screen.getByLabelText(/Email/)).toBeRequired();
  });
});

describe("keyboard", () => {
  it("reaches every control in the order the questions are asked", async () => {
    draw();
    const user = userEvent.setup();

    await user.tab();
    expect(screen.getByLabelText(/Your name/)).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText(/Email/)).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText(/Message/)).toHaveFocus();
  });

  it("never puts the honeypot in the tab order", async () => {
    const { container } = draw();
    const trap = container.querySelector('input[name="__wb_company"]');

    expect(trap).toHaveAttribute("tabindex", "-1");
    // And it is hidden from assistive technology too, so it is never announced as a question.
    expect(trap?.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe("the outcome", () => {
  it("is announced in a live region focus can be moved to", () => {
    const { container } = draw();

    const status = container.querySelector("[data-wb-form-status]");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveAttribute("aria-live", "polite");
    // The runtime moves focus here after a successful send, so it has to be focusable.
    expect(status).toHaveAttribute("tabindex", "-1");

    const errors = container.querySelector("[data-wb-form-errors]");
    expect(errors).toHaveAttribute("role", "alert");
    expect(errors).toHaveAttribute("tabindex", "-1");
  });
});
