import { z } from "zod";

import {
  flexLayoutSchema,
  gridLayoutSchema,
  serializeFlexLayout,
  serializeGridLayout,
  type FlexLayout,
  type GridLayout,
} from "./layout";

/**
 * Container queries.
 *
 * A breakpoint answers "how wide is the window". A container query answers "how wide is the space
 * this thing is actually in", which is the only way one reusable section can render as a row in a
 * wide main area and as a stack in a narrow sidebar at the same viewport width.
 *
 * The rules here are structured data, never CSS strings from a user. They are serialised through
 * the same allowlisted property writers the inline styles use, so nothing a designer types can
 * become a raw declaration.
 */
export const containerNameSchema = z
  .string()
  .min(1)
  .max(40)
  // A CSS identifier, so the generated rule cannot be broken out of by the name itself.
  .regex(/^[a-z][a-z0-9-]*$/, "must be lowercase letters, digits and hyphens, starting with a letter");

export const sectionContainerSchema = z
  .object({
    /** Opt-in. A section is not a query container until someone says so. */
    enabled: z.boolean(),
    name: containerNameSchema.optional(),
  })
  .strict();

export type SectionContainer = z.infer<typeof sectionContainerSchema>;

export const containerRuleSchema = z
  .object({
    /** Unnamed rules match the nearest container, which is CSS's own default. */
    container: containerNameSchema.optional(),
    minWidth: z.number().int().min(0).max(4000),
    grid: gridLayoutSchema.partial().optional(),
    flex: flexLayoutSchema.partial().optional(),
  })
  .strict();

export type ContainerRule = z.infer<typeof containerRuleSchema>;

export type ContainerIssue =
  | { code: "duplicate-name"; name: string; sectionIds: string[] }
  | { code: "unknown-container"; name: string; sectionId: string }
  | { code: "self-reference"; name: string; sectionId: string }
  | { code: "container-without-name"; sectionId: string };

export type ContainerNode = {
  id: string;
  container?: SectionContainer;
  containerRules?: ContainerRule[];
  children?: ContainerNode[];
};

/**
 * Checks a section tree's container declarations.
 *
 * Two ancestors sharing a name is the ambiguity worth catching: CSS silently resolves it to the
 * nearest one, so the layout works until someone moves a section and it quietly changes. A rule
 * naming a container that is not an ancestor never matches at all, which looks like a rule that
 * does nothing rather than a mistake.
 */
export function validateContainers(roots: readonly ContainerNode[]): ContainerIssue[] {
  const issues: ContainerIssue[] = [];
  const declaredBy = new Map<string, string[]>();

  const walk = (node: ContainerNode, ancestorNames: string[]): void => {
    const container = node.container;
    let names = ancestorNames;

    if (container?.enabled === true) {
      if (container.name === undefined) {
        issues.push({ code: "container-without-name", sectionId: node.id });
      } else {
        declaredBy.set(container.name, [...(declaredBy.get(container.name) ?? []), node.id]);
        if (ancestorNames.includes(container.name)) {
          issues.push({ code: "duplicate-name", name: container.name, sectionIds: [node.id] });
        }
        names = [...ancestorNames, container.name];
      }
    }

    for (const rule of node.containerRules ?? []) {
      if (rule.container === undefined) continue;

      // A section querying its own container asks how wide it is inside itself.
      if (rule.container === container?.name) {
        issues.push({ code: "self-reference", name: rule.container, sectionId: node.id });
        continue;
      }
      if (!ancestorNames.includes(rule.container)) {
        issues.push({ code: "unknown-container", name: rule.container, sectionId: node.id });
      }
    }

    for (const child of node.children ?? []) walk(child, names);
  };

  for (const root of roots) walk(root, []);

  // Reported once per name rather than once per node, so a name used in three places is one issue.
  for (const [name, sectionIds] of declaredBy) {
    if (sectionIds.length > 1 && !issues.some((issue) => issue.code === "duplicate-name" && issue.name === name)) {
      issues.push({ code: "duplicate-name", name, sectionIds });
    }
  }

  return issues;
}

/** The inline style that makes a section a query container. */
export function serializeContainer(container: SectionContainer | undefined): Record<string, string> {
  if (container?.enabled !== true) return {};
  return {
    // `inline-size` only: `size` requires a fixed block size and collapses content that has none.
    containerType: "inline-size",
    ...(container.name === undefined ? {} : { containerName: container.name }),
  };
}

/**
 * Generates the `@container` rules for one section.
 *
 * Scoped by the section's own id attribute so a rule can never reach another section, and sorted by
 * width so the widest matching rule wins in the order CSS applies them.
 */
export function serializeContainerRules(
  sectionId: string,
  layoutMode: "free" | "grid" | "flex",
  rules: readonly ContainerRule[],
): string {
  if (layoutMode === "free" || rules.length === 0) return "";

  const selector = `[data-section-id="${cssEscape(sectionId)}"]`;

  return [...rules]
    .sort((a, b) => a.minWidth - b.minWidth)
    .map((rule) => {
      const declarations = declarationsFor(layoutMode, rule);
      if (declarations === "") return "";

      const condition = rule.container === undefined ? "" : `${rule.container} `;
      return `@container ${condition}(min-width: ${rule.minWidth}px) { ${selector} { ${declarations} } }`;
    })
    .filter((rule) => rule !== "")
    .join("\n");
}

function declarationsFor(layoutMode: "grid" | "flex", rule: ContainerRule): string {
  // Serialised through the same writers the inline styles use, so a container rule can only ever
  // emit properties the renderer already allows.
  const source =
    layoutMode === "grid"
      ? rule.grid === undefined
        ? null
        : serializeGridLayout({ ...FALLBACK_GRID, ...rule.grid } as GridLayout)
      : rule.flex === undefined
        ? null
        : serializeFlexLayout({ ...FALLBACK_FLEX, ...rule.flex } as FlexLayout);

  if (source === null) return "";

  const changed = layoutMode === "grid" ? rule.grid : rule.flex;
  const allowed = new Set(Object.keys(changed ?? {}));

  return Object.entries(source)
    // Only the properties this rule actually set. Emitting the whole serialised layout would make
    // every rule override everything, including values the designer never touched.
    .filter(([property]) => touches(allowed, property))
    .map(([property, value]) => `${kebab(property)}: ${value};`)
    .join(" ");
}

/** Maps a serialised CSS property back to the structured field(s) that produce it. */
function touches(fields: ReadonlySet<string>, cssProperty: string): boolean {
  const sources: Record<string, string[]> = {
    gridTemplateColumns: ["columns", "autoMode", "minColumnWidth"],
    rowGap: ["rowGap"],
    columnGap: ["columnGap"],
    gap: ["gap"],
    padding: ["paddingX", "paddingY"],
    justifyItems: ["justifyItems"],
    alignItems: ["alignItems"],
    flexDirection: ["direction"],
    flexWrap: ["wrap"],
    justifyContent: ["justifyContent"],
    display: [],
  };

  return (sources[cssProperty] ?? []).some((field) => fields.has(field));
}

const FALLBACK_GRID = {
  columns: 3,
  autoMode: "auto-fit",
  minColumnWidth: 240,
  rowGap: 24,
  columnGap: 24,
  paddingX: 24,
  paddingY: 48,
  justifyItems: "stretch",
  alignItems: "start",
} as const;

const FALLBACK_FLEX = {
  direction: "row",
  wrap: "wrap",
  gap: 24,
  paddingX: 24,
  paddingY: 48,
  justifyContent: "start",
  alignItems: "start",
} as const;

function kebab(property: string): string {
  return property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** Ids are generated, but this is generated CSS: an unescaped quote would end the selector. */
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}
