// Canonical role names support identity labels and privileged account controls.
// Page and action access comes from the effective session permissions.

export const USER_ROLES = [
  "Super Admin",
  "Admin",
  "Technician",
  "Engineering Executive",
  "Engineering Manager",
  "Store Keeper",
  "Supervisor",
  "Viewer",
] as const;

export type Role = (typeof USER_ROLES)[number];

const ROLE_ALIASES: Record<string, string> = {
  "super admin": "Super Admin",
  "admin": "Admin",
  "warehouse admin": "Admin",
  "technician": "Technician",
  "engineering executive": "Engineering Executive",
  "engineering manager": "Engineering Manager",
  "storekeeper": "Store Keeper",
  "store keeper": "Store Keeper",
  "supervisor": "Supervisor",
  "viewer": "Viewer",
  "superadmin": "Super Admin",
};

export function normalizeRole(role?: string | null) {
  if (!role) return null;
  const trimmed = role.trim();
  if (!trimmed) return null;
  const normalized = ROLE_ALIASES[trimmed.toLowerCase()] ?? trimmed;
  return USER_ROLES.includes(normalized as Role) ? (normalized as Role) : null;
}

export const ADMIN_ROLES: Role[] = ["Super Admin", "Admin"];
export const MOVEMENT_ROLES: Role[] = ["Super Admin", "Admin", "Supervisor", "Store Keeper"];
export const ADJUSTMENT_ROLES: Role[] = ["Super Admin", "Admin", "Supervisor"];
export const ACTIVITY_ROLES: Role[] = ["Super Admin", "Admin", "Supervisor"];

export function hasRole(role: string | undefined, allowed: readonly string[]) {
  const normalizedRole = normalizeRole(role);
  if (!normalizedRole) return false;
  return allowed.some((candidate) => normalizeRole(candidate) === normalizedRole);
}

export const canManageMasterData = (role?: string) => hasRole(role, ADMIN_ROLES);
export const canMoveStock = (role?: string) => hasRole(role, MOVEMENT_ROLES);
export const canAdjustStock = (role?: string) => hasRole(role, ADJUSTMENT_ROLES);
export const canManageUsers = (role?: string) => hasRole(role, ADMIN_ROLES);
export const canViewActivity = (role?: string) => hasRole(role, ACTIVITY_ROLES);

// Material requests (see backend/controllers/materialRequestController.js)
export const MR_CREATE_ROLES: Role[] = ["Technician", "Super Admin", "Admin"];
export const MR_APPROVER_ROLES: Role[] = ["Engineering Executive", "Engineering Manager"];
export const MR_STORE_ROLES: Role[] = ["Store Keeper", "Super Admin", "Admin"];

export const canCreateMr = (role?: string) => hasRole(role, MR_CREATE_ROLES);
export const canApproveMr = (role?: string) => hasRole(role, MR_APPROVER_ROLES);
export const canIssueMr = (role?: string) => hasRole(role, MR_STORE_ROLES);
export const canViewApprovals = (role?: string) => hasRole(role, [...MR_APPROVER_ROLES, ...ADMIN_ROLES]);

export const NEW_ITEM_CREATE_ROLES: Role[] = ["Technician", "Super Admin", "Admin"];
export const NEW_ITEM_REVIEW_ROLES: Role[] = ["Engineering Executive", "Super Admin", "Admin"];
export const canCreateNewItem = (role?: string) => hasRole(role, NEW_ITEM_CREATE_ROLES);
export const canReviewNewItem = (role?: string) => hasRole(role, NEW_ITEM_REVIEW_ROLES);

export function canPermission(user: { permissions?: Record<string, boolean> } | null | undefined, key: string) {
  const page = key.includes(".") ? key.split(".")[0] : null;
  return user?.permissions?.[key] === true && (!page || user.permissions[page] === true);
}
