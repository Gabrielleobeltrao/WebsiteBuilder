import { describe, expect, it } from "vitest";

import { builderElementSchema } from "./elements";
import { fixtureButton, fixtureText } from "./responsive-fixtures";
import { px, responsiveStyleOverrideSchema, styleOverrideMatchesElement } from "./responsive";

/** An element carrying the given overrides, parsed exactly as a saved document would be. */
const withOverrides = (element: ReturnType<typeof fixtureText>, overrides: unknown) =>
  builderElementSchema.safeParse({ ...element, breakpointOverrides: overrides });

describe("what a device may override", () => {
  it("accepts geometry, layout, style and the authored reference width together", () => {
    const result = withOverrides(fixtureText({ id: "t", x: 0, y: 0, width: 300 }), {
      mobile: {
        geometry: { x: 16, width: 358 },
        layout: { horizontalConstraint: "stretch" },
        style: { type: "text", fontSize: px(15), textAlign: "center" },
        referenceWidth: 390,
      },
    });

    expect(result.success).toBe(true);
  });

  it("refuses a style property that is not in the responsive subset", () => {
    // The subset is the properties whose right value genuinely differs between devices. Everything
    // else would be a second styling system with no editor behind it.
    const result = withOverrides(fixtureText({ id: "t", x: 0, y: 0, width: 300 }), {
      mobile: { style: { type: "text", color: "#ff0000" } },
    });

    expect(result.success).toBe(false);
  });

  it("refuses an untyped style bag", () => {
    const result = withOverrides(fixtureText({ id: "t", x: 0, y: 0, width: 300 }), {
      mobile: { style: { fontSize: px(15) } },
    });

    expect(result.success).toBe(false);
  });

  it("refuses a raw CSS string anywhere in an override", () => {
    // These values reach a stylesheet. A string here is the hole the structured model exists to
    // close, so it must fail at the boundary rather than at the point it would be serialised.
    for (const style of [
      { type: "text", fontSize: "15px; color: red" },
      { type: "text", lineHeight: "1.5" },
      { type: "container", gap: "calc(100% - 1px)" },
    ]) {
      expect(withOverrides(fixtureText({ id: "t", x: 0, y: 0, width: 300 }), { mobile: { style } }).success).toBe(
        false,
      );
    }
  });

  it("bounds the reference width to something a screen could be", () => {
    const element = fixtureText({ id: "t", x: 0, y: 0, width: 300 });
    expect(withOverrides(element, { mobile: { referenceWidth: 390 } }).success).toBe(true);
    expect(withOverrides(element, { mobile: { referenceWidth: 0 } }).success).toBe(false);
    expect(withOverrides(element, { mobile: { referenceWidth: 99_999 } }).success).toBe(false);
  });

  it("refuses a key the override shape does not define", () => {
    const element = fixtureText({ id: "t", x: 0, y: 0, width: 300 });
    expect(withOverrides(element, { mobile: { somethingElse: 1 } }).success).toBe(false);
  });
});

describe("style overrides belong to their element type", () => {
  it("parses each type's own subset", () => {
    expect(responsiveStyleOverrideSchema.safeParse({ type: "text", lineHeight: 1.2 }).success).toBe(true);
    expect(responsiveStyleOverrideSchema.safeParse({ type: "button", widthBehavior: "fill" }).success).toBe(true);
    expect(responsiveStyleOverrideSchema.safeParse({ type: "image", objectFit: "cover" }).success).toBe(true);
    expect(responsiveStyleOverrideSchema.safeParse({ type: "container", direction: "column" }).success).toBe(true);
  });

  it("does not let one type's properties appear on another", () => {
    expect(responsiveStyleOverrideSchema.safeParse({ type: "button", lineHeight: 1.2 }).success).toBe(false);
    expect(responsiveStyleOverrideSchema.safeParse({ type: "text", widthBehavior: "fill" }).success).toBe(false);
    expect(responsiveStyleOverrideSchema.safeParse({ type: "image", direction: "row" }).success).toBe(false);
  });

  it("catches a well-formed override attached to the wrong element", () => {
    // Both of these parse on their own. Only the element they sit on makes one of them wrong, which
    // is why the check exists beside the schema rather than inside it.
    const button = fixtureButton({ id: "b", x: 0, y: 0, width: 200 });
    const textStyle = { type: "text" as const, lineHeight: 1.4 };

    expect(styleOverrideMatchesElement(button.type, textStyle)).toBe(false);
    expect(styleOverrideMatchesElement(button.type, { type: "button", widthBehavior: "fill" })).toBe(true);
  });
});
