import type { CmsField } from "@websitebuilder/shared";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { CollectionEditor, type CollectionDraft } from "@/features/cms/CollectionEditor";
import { renderWithProviders } from "@/test/render";

function Harness({ initial }: { initial?: Partial<CollectionDraft> }) {
  const [draft, setDraft] = useState<CollectionDraft>({
    name: "",
    slug: "",
    fields: [],
    hasDetailRoute: true,
    ...initial,
  });

  return (
    <>
      <CollectionEditor draft={draft} onChange={setDraft} />
      <output data-testid="state">{JSON.stringify(draft)}</output>
    </>
  );
}

const state = (): CollectionDraft => JSON.parse(screen.getByTestId("state").textContent ?? "{}") as CollectionDraft;

describe("address", () => {
  it("follows the name until it is edited directly", async () => {
    renderWithProviders(<Harness />);

    await userEvent.type(screen.getByLabelText("Name"), "Case Studies");
    expect(state().slug).toBe("case-studies");
  });

  it("stops following once someone edits it", async () => {
    // A public path that keeps moving while you type is a broken link waiting to happen.
    renderWithProviders(<Harness />);

    await userEvent.type(screen.getByLabelText("Address"), "cases");
    await userEvent.type(screen.getByLabelText("Name"), "Case Studies");

    expect(state().slug).toBe("cases");
  });

  it("normalises what was typed when the field is left", async () => {
    renderWithProviders(<Harness />);

    await userEvent.type(screen.getByLabelText("Address"), "Case Studies!");
    await userEvent.tab();

    expect(state().slug).toBe("case-studies");
  });
});

describe("fields", () => {
  it("gives every new field an id that is not derived from its label", async () => {
    renderWithProviders(<Harness />);

    await userEvent.click(screen.getByRole("button", { name: "Add field" }));
    const [field] = state().fields;

    expect(field?.id).toBeTruthy();
    expect(field?.id).not.toBe(field?.label);
  });

  it("keeps a field's id when its label changes", async () => {
    // Everything stored on an item is keyed by this id, so a rename must not touch a single value.
    renderWithProviders(<Harness />);

    await userEvent.click(screen.getByRole("button", { name: "Add field" }));
    const before = state().fields[0]?.id;

    await userEvent.type(screen.getByLabelText("Label 1"), "Client name");
    const after = state().fields[0];

    expect(after?.id).toBe(before);
    expect(after?.label).toBe("Client name");
  });

  it("changes a field's type", async () => {
    renderWithProviders(<Harness />);

    await userEvent.click(screen.getByRole("button", { name: "Add field" }));
    await userEvent.selectOptions(screen.getByLabelText("Type 1"), "number");

    expect(state().fields[0]?.type).toBe("number");
  });

  it("removes a field from the schema without touching the others", async () => {
    const fields: CmsField[] = [
      { id: "a", key: "a", label: "First", type: "shortText", required: false },
      { id: "b", key: "b", label: "Second", type: "shortText", required: false },
    ];
    renderWithProviders(<Harness initial={{ fields }} />);

    await userEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);

    expect(state().fields.map((field) => field.id)).toEqual(["b"]);
  });
});

describe("detail routes", () => {
  it("can be turned off for data that only appears in lists", async () => {
    renderWithProviders(<Harness />);

    await userEvent.click(screen.getByLabelText("Give each item its own page"));
    expect(state().hasDetailRoute).toBe(false);
  });
});
