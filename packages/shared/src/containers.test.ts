import { describe, expect, it } from "vitest";

import {
  serializeContainer,
  serializeContainerRules,
  validateContainers,
  type ContainerNode,
} from "./containers";

const section = (id: string, overrides: Partial<ContainerNode> = {}): ContainerNode => ({ id, ...overrides });

describe("declaring a container", () => {
  it("does nothing until a section opts in", () => {
    expect(serializeContainer(undefined)).toEqual({});
    expect(serializeContainer({ enabled: false, name: "sidebar" })).toEqual({});
  });

  it("uses inline-size, which does not need a fixed height", () => {
    expect(serializeContainer({ enabled: true, name: "sidebar" })).toEqual({
      containerType: "inline-size",
      containerName: "sidebar",
    });
  });
});

describe("validation", () => {
  it("accepts a container queried by a descendant", () => {
    const tree = [
      section("outer", {
        container: { enabled: true, name: "main" },
        children: [section("inner", { containerRules: [{ container: "main", minWidth: 600 }] })],
      }),
    ];

    expect(validateContainers(tree)).toEqual([]);
  });

  it("reports a rule naming a container that is not an ancestor", () => {
    const tree = [
      section("outer", {
        container: { enabled: true, name: "main" },
        children: [section("inner", { containerRules: [{ container: "sidebar", minWidth: 600 }] })],
      }),
    ];

    // Such a rule never matches, which reads as a rule that does nothing rather than a mistake.
    expect(validateContainers(tree)).toEqual([{ code: "unknown-container", name: "sidebar", sectionId: "inner" }]);
  });

  it("reports a section querying its own container", () => {
    const tree = [
      section("outer", {
        container: { enabled: true, name: "main" },
        containerRules: [{ container: "main", minWidth: 600 }],
      }),
    ];

    expect(validateContainers(tree)).toContainEqual({ code: "self-reference", name: "main", sectionId: "outer" });
  });

  it("reports one name declared by two sections", () => {
    const tree = [
      section("a", { container: { enabled: true, name: "card" } }),
      section("b", { container: { enabled: true, name: "card" } }),
    ];

    // CSS resolves this to the nearest container silently, so the layout works until someone moves
    // a section and it quietly changes.
    expect(validateContainers(tree)).toEqual([{ code: "duplicate-name", name: "card", sectionIds: ["a", "b"] }]);
  });

  it("reports a nested container shadowing an ancestor of the same name", () => {
    const tree = [
      section("outer", {
        container: { enabled: true, name: "card" },
        children: [section("inner", { container: { enabled: true, name: "card" } })],
      }),
    ];

    expect(validateContainers(tree).some((issue) => issue.code === "duplicate-name")).toBe(true);
  });

  it("reports a container that was enabled without a name", () => {
    expect(validateContainers([section("a", { container: { enabled: true } })])).toEqual([
      { code: "container-without-name", sectionId: "a" },
    ]);
  });

  it("allows an unnamed rule, which matches the nearest container as CSS does", () => {
    const tree = [section("a", { containerRules: [{ minWidth: 500, grid: { columns: 2 } }] })];
    expect(validateContainers(tree)).toEqual([]);
  });
});

describe("generated CSS", () => {
  it("emits nothing for a free-layout section", () => {
    expect(serializeContainerRules("s1", "free", [{ minWidth: 500, grid: { columns: 2 } }])).toBe("");
  });

  it("scopes every rule to the section it belongs to", () => {
    const css = serializeContainerRules("s1", "grid", [{ minWidth: 500, grid: { columns: 2, autoMode: "fixed" } }]);

    expect(css).toContain('[data-section-id="s1"]');
    expect(css).toContain("@container (min-width: 500px)");
    expect(css).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
  });

  it("names the container when the rule names one", () => {
    const css = serializeContainerRules("s1", "flex", [{ container: "sidebar", minWidth: 400, flex: { direction: "column" } }]);
    expect(css).toContain("@container sidebar (min-width: 400px)");
    expect(css).toContain("flex-direction: column;");
  });

  it("emits only the properties the rule set", () => {
    const css = serializeContainerRules("s1", "flex", [{ minWidth: 400, flex: { direction: "column" } }]);

    // Emitting the whole serialised layout would make every rule override values nobody touched.
    expect(css).toContain("flex-direction");
    expect(css).not.toContain("justify-content");
    expect(css).not.toContain("padding");
  });

  it("orders rules by width so the widest match wins", () => {
    const css = serializeContainerRules("s1", "grid", [
      { minWidth: 900, grid: { columns: 4, autoMode: "fixed" } },
      { minWidth: 500, grid: { columns: 2, autoMode: "fixed" } },
    ]);

    expect(css.indexOf("min-width: 500px")).toBeLessThan(css.indexOf("min-width: 900px"));
  });

  it("cannot be escaped through the section id", () => {
    const css = serializeContainerRules('s"1', "grid", [{ minWidth: 500, grid: { columns: 2 } }]);
    expect(css).toContain('[data-section-id="s\\"1"]');
  });

  it("skips a rule that changes nothing", () => {
    expect(serializeContainerRules("s1", "grid", [{ minWidth: 500 }])).toBe("");
  });
});
