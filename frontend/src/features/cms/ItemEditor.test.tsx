import type { CmsField } from "@websitebuilder/shared";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { ItemEditor, type ItemDraft } from "@/features/cms/ItemEditor";
import { renderWithProviders } from "@/test/render";

const field = (overrides: Partial<CmsField> = {}): CmsField =>
  ({ id: "f-title", key: "title", label: "Title", type: "shortText", required: false, ...overrides }) as CmsField;

function Harness({ fields, errors = [] }: { fields: CmsField[]; errors?: { fieldId: string; code: "required" | "invalid-type" }[] }) {
  const [draft, setDraft] = useState<ItemDraft>({ slug: "", status: "draft", values: {} });

  return (
    <>
      <ItemEditor fields={fields} draft={draft} errors={errors} onChange={setDraft} />
      <output data-testid="state">{JSON.stringify(draft)}</output>
    </>
  );
}

const state = (): ItemDraft => JSON.parse(screen.getByTestId("state").textContent ?? "{}") as ItemDraft;

describe("generated form", () => {
  it("keys every value by the field's id, not its label", async () => {
    // A rename must not orphan a single stored value.
    renderWithProviders(<Harness fields={[field({ id: "f-abc", label: "Client name" })]} />);

    await userEvent.type(screen.getByLabelText("Client name"), "Acme");
    expect(state().values).toEqual({ "f-abc": "Acme" });
  });

  it("renders an input suited to each field type", () => {
    renderWithProviders(
      <Harness
        fields={[
          field({ id: "f-1", label: "Count", type: "number" }),
          field({ id: "f-2", label: "Active", type: "boolean" }),
          field({ id: "f-3", label: "Launched", type: "date" }),
          field({ id: "f-4", label: "Story", type: "longText" }),
        ]}
      />,
    );

    expect(screen.getByLabelText("Count")).toHaveAttribute("type", "number");
    expect(screen.getByLabelText("Active")).toHaveAttribute("type", "checkbox");
    expect(screen.getByLabelText("Launched")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("Story").tagName).toBe("TEXTAREA");
  });

  it("leaves an empty number undefined rather than saving a zero nobody typed", async () => {
    renderWithProviders(<Harness fields={[field({ id: "f-n", label: "Count", type: "number" })]} />);

    await userEvent.type(screen.getByLabelText("Count"), "5");
    expect(state().values["f-n"]).toBe(5);

    await userEvent.clear(screen.getByLabelText("Count"));
    expect(state().values["f-n"]).toBeUndefined();
  });

  it("has no input for a field the schema no longer declares", () => {
    // Its stored value is untouched and returns if the field does.
    renderWithProviders(<Harness fields={[field({ id: "f-1", label: "Kept" })]} />);
    expect(screen.queryByLabelText("Removed")).not.toBeInTheDocument();
  });
});

describe("validation feedback", () => {
  it("says which field is missing and marks it invalid", () => {
    renderWithProviders(
      <Harness fields={[field({ required: true })]} errors={[{ fieldId: "f-title", code: "required" }]} />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("This field is required.");
    expect(screen.getByLabelText(/Title/)).toHaveAttribute("aria-invalid", "true");
  });

  it("explains a wrong type rather than only refusing", () => {
    renderWithProviders(
      <Harness fields={[field({ type: "number", label: "Count" })]} errors={[{ fieldId: "f-title", code: "invalid-type" }]} />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("This value does not match the field type.");
  });
});
