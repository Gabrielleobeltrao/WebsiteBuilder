/**
 * Workspace roles and what each may do.
 *
 * The matrix lives in one place and is evaluated on the server only. A role that arrives in a
 * request body or a header is data, not authority — it is never read here.
 */
export const WORKSPACE_ROLES = ["owner", "admin", "designer", "editor", "viewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const PERMISSIONS = [
  "workspace:read",
  "workspace:manage",
  "member:manage",
  "client:read",
  "client:manage",
  "project:read",
  "project:create",
  "project:edit",
  "project:delete",
  "media:read",
  "media:upload",
  "media:delete",
  "publish:execute",
  "domain:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const VIEWER: Permission[] = ["workspace:read", "client:read", "project:read", "media:read"];

const EDITOR: Permission[] = [...VIEWER, "project:edit", "media:upload"];

const DESIGNER: Permission[] = [...EDITOR, "project:create", "media:delete"];

const ADMIN: Permission[] = [
  ...DESIGNER,
  "client:manage",
  "member:manage",
  "project:delete",
  "publish:execute",
  "domain:manage",
];

const OWNER: Permission[] = [...ADMIN, "workspace:manage"];

const BY_ROLE: Record<WorkspaceRole, readonly Permission[]> = {
  viewer: VIEWER,
  editor: EDITOR,
  designer: DESIGNER,
  admin: ADMIN,
  owner: OWNER,
};

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === "string" && (WORKSPACE_ROLES as readonly string[]).includes(value);
}

export function can(role: WorkspaceRole, permission: Permission): boolean {
  return BY_ROLE[role].includes(permission);
}

export function permissionsFor(role: WorkspaceRole): readonly Permission[] {
  return BY_ROLE[role];
}
