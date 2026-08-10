import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Catches user-facing copy written directly into a component instead of a locale resource.
 *
 * It is a heuristic, not a parser: it looks for JSX text nodes and for text-bearing attributes
 * holding a literal. That is enough to fail the obvious mistake at review time. A deliberate
 * exception is marked with `i18n-exempt` on the same line.
 */

// Vitest runs with the frontend workspace as its root.
const SRC = join(process.cwd(), "src");

const COVERED_DIRECTORIES = ["app", "components", "features", "routes"];

/** Short symbols and punctuation are not prose — flagging them would only train people to ignore this test. */
const IGNORED_TEXT = /^(?:[\s\d\p{P}\p{S}]*|[A-Za-z]{1,2})$/u;

function walk(directory: string): string[] {
  const entries = readdirSync(directory);
  return entries.flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return extname(full) === ".tsx" ? [full] : [];
  });
}

function collectFiles(): string[] {
  return COVERED_DIRECTORIES.flatMap((directory) => {
    const full = join(SRC, directory);
    try {
      return statSync(full).isDirectory() ? walk(full) : [];
    } catch {
      return [];
    }
  }).filter((file) => !file.endsWith(".test.tsx"));
}

// Requires a closing tag so a TypeScript generic such as `Promise<unknown>` is not mistaken for
// rendered text.
const JSX_TEXT = />([^<>{}\n]+)<\//g;
const TEXT_ATTRIBUTE = /\b(?:placeholder|aria-label|title|alt|label)\s*=\s*"([^"]+)"/g;

function findViolations(source: string, file: string): string[] {
  const violations: string[] = [];
  const lines = source.split("\n");

  for (const [index, line] of lines.entries()) {
    if (line.includes("i18n-exempt")) continue;

    for (const match of line.matchAll(JSX_TEXT)) {
      const text = (match[1] ?? "").trim();
      if (text.length > 0 && !IGNORED_TEXT.test(text)) {
        violations.push(`${file}:${index + 1} literal JSX text ${JSON.stringify(text)}`);
      }
    }
    for (const match of line.matchAll(TEXT_ATTRIBUTE)) {
      const text = (match[1] ?? "").trim();
      if (text.length > 0 && !IGNORED_TEXT.test(text)) {
        violations.push(`${file}:${index + 1} literal attribute text ${JSON.stringify(text)}`);
      }
    }
  }
  return violations;
}

describe("no hardcoded user-facing copy", () => {
  it("finds every covered component", () => {
    expect(collectFiles().length).toBeGreaterThan(3);
  });

  it("has no literal copy in covered components", () => {
    const violations = collectFiles().flatMap((file) =>
      findViolations(readFileSync(file, "utf8"), relative(SRC, file)),
    );
    expect(violations).toEqual([]);
  });

  it("detects a violation when one is introduced", () => {
    const bad = '<button aria-label="Close menu">Save changes</button>';
    expect(findViolations(bad, "fixture.tsx")).toHaveLength(2);
  });

  it("respects an explicit exemption", () => {
    const exempt = '<span>Website Builder</span> {/* i18n-exempt: brand name */}';
    expect(findViolations(exempt, "fixture.tsx")).toEqual([]);
  });
});
