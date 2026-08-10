import { describe, expect, it } from "vitest";

import { can, isWorkspaceRole, permissionsFor, WORKSPACE_ROLES } from "../src/modules/workspaces/permissions";

describe("role matrix", () => {
  it("gives a viewer read access and nothing more", () => {
    expect(can("viewer", "project:read")).toBe(true);
    expect(can("viewer", "project:edit")).toBe(false);
    expect(can("viewer", "project:delete")).toBe(false);
    expect(can("viewer", "media:upload")).toBe(false);
    expect(can("viewer", "publish:execute")).toBe(false);
  });

  it("lets an editor change content but not create or delete sites", () => {
    expect(can("editor", "project:edit")).toBe(true);
    expect(can("editor", "media:upload")).toBe(true);
    expect(can("editor", "project:create")).toBe(false);
    expect(can("editor", "project:delete")).toBe(false);
  });

  it("lets a designer create sites but not manage members or publish", () => {
    expect(can("designer", "project:create")).toBe(true);
    expect(can("designer", "media:delete")).toBe(true);
    expect(can("designer", "member:manage")).toBe(false);
    expect(can("designer", "publish:execute")).toBe(false);
  });

  it("lets an admin publish and manage members but not the workspace itself", () => {
    expect(can("admin", "publish:execute")).toBe(true);
    expect(can("admin", "member:manage")).toBe(true);
    expect(can("admin", "domain:manage")).toBe(true);
    expect(can("admin", "workspace:manage")).toBe(false);
  });

  it("reserves workspace management for the owner", () => {
    expect(can("owner", "workspace:manage")).toBe(true);
  });

  it("keeps every role a superset of the one below it", () => {
    const ladder = ["viewer", "editor", "designer", "admin", "owner"] as const;
    for (let index = 1; index < ladder.length; index += 1) {
      const lower = permissionsFor(ladder[index - 1]!);
      const higher = permissionsFor(ladder[index]!);
      expect(lower.every((permission) => higher.includes(permission))).toBe(true);
    }
  });

  it("rejects a role that did not come from the allowlist", () => {
    for (const candidate of ["superadmin", "OWNER", "", null, undefined, 1, {}]) {
      expect(isWorkspaceRole(candidate)).toBe(false);
    }
    for (const role of WORKSPACE_ROLES) expect(isWorkspaceRole(role)).toBe(true);
  });
});
