import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `docs/FORMS.md` is the authoritative statement of what owns what in a form, and §7 of it is a map
 * of where that ownership is implemented. A map is only worth having while it is true, so this test
 * reads the map and asserts every path in it still exists.
 *
 * It is deliberately structural rather than semantic: no test can check that a document describes
 * the code correctly, but this one catches the failure that actually happens — a file being moved
 * or renamed and the document being left behind.
 */
const root = fileURLToPath(new URL("../../../", import.meta.url));
const doc = readFileSync(`${root}docs/FORMS.md`, "utf8");

/** The fenced block under the "Where the code is" heading. */
function codeMap(): string[] {
  const section = doc.split("## 7. Where the code is")[1] ?? "";
  const fence = section.split("```")[1] ?? "";
  return fence
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[0] ?? "")
    .filter((path) => path.length > 0);
}

describe("the forms contract document", () => {
  it("names the four owners the code is written against", () => {
    for (const owner of ["Definition", "Placement", "Published snapshot", "Submission"]) {
      expect(doc).toContain(owner);
    }
  });

  it("points only at files that exist", () => {
    const paths = codeMap();
    expect(paths.length).toBeGreaterThan(0);

    for (const path of paths) {
      expect(existsSync(`${root}${path}`), path).toBe(true);
    }
  });
});
