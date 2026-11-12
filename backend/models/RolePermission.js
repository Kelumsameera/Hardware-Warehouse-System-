import mongoose from "mongoose";

export const ROLE_ALIASES = {
  "super admin": "Super Admin",
  "superadmin": "Super Admin",
  "warehouse admin": "Admin",
  "storekeeper": "Store Keeper",
  "store keeper": "Store Keeper",
  "admin": "Admin",
  "technician": "Technician",
  "engineering executive": "Engineering Executive",
  "engineering manager": "Engineering Manager",
  "supervisor": "Supervisor",
  "viewer": "Viewer",
};

export function normalizeRoleName(role) {
  if (!role || typeof role !== "string") return null;
  const trimmed = role.trim();
  if (!trimmed) return null;
  const alias = ROLE_ALIASES[trimmed.toLowerCase()];
  const candidate = alias || trimmed;
  return Object.prototype.hasOwnProperty.call(DEFAULT_ROLE_PERMISSIONS, candidate) ? candidate : null;
}

const DEFAULT_ROLE_PERMISSIONS = {
  "Super Admin": {
    dashboard: true,
    items: true,
    warehouses: true,
    inventory: true,
    materialRequests: true,
    newItemRequests: true,
    movements: true,
    alerts: true,
    notifications: true,
    reports: true,
    users: true,
    settings: true,
  },
  Admin: {
    dashboard: true,
    items: true,
    warehouses: true,
    inventory: true,
    materialRequests: true,
    newItemRequests: true,
    movements: true,
    alerts: true,
    notifications: true,
    reports: true,
    users: true,
    settings: true,
  },
  Supervisor: {
    dashboard: true,
    items: true,
    warehouses: true,
    inventory: true,
    materialRequests: true,
    newItemRequests: true,
    movements: true,
    alerts: true,
    notifications: true,
    reports: true,
    users: false,
    settings: true,
  },
  "Store Keeper": {
    dashboard: true,
    items: true,
    warehouses: true,
    inventory: true,
    materialRequests: true,
    newItemRequests: false,
    movements: true,
    alerts: true,
    notifications: true,
    reports: true,
    users: false,
    settings: true,
  },
  Technician: {
    dashboard: true,
    items: true,
    warehouses: false,
    inventory: true,
    materialRequests: true,
    newItemRequests: true,
    movements: false,
    alerts: true,
    notifications: true,
    reports: false,
    users: false,
    settings: true,
  },
  Viewer: {
    dashboard: true,
    items: true,
    warehouses: false,
    inventory: true,
    materialRequests: false,
    newItemRequests: false,
    movements: false,
    alerts: true,
    notifications: true,
    reports: true,
    users: false,
    settings: true,
  },
  "Engineering Executive": {
    dashboard: true,
    items: true,
    warehouses: false,
    inventory: true,
    materialRequests: true,
    newItemRequests: true,
    movements: false,
    alerts: true,
    notifications: true,
    reports: true,
    users: false,
    settings: true,
  },
  "Engineering Manager": {
    dashboard: true,
    items: true,
    warehouses: false,
    inventory: true,
    materialRequests: true,
    newItemRequests: true,
    movements: false,
    alerts: true,
    notifications: true,
    reports: true,
    users: false,
    settings: true,
  },
};

const rolePermissionSchema = new mongoose.Schema(
  {
    accountRevision: { type: Number, default: 0, select: false },
    role: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      enum: Object.keys(DEFAULT_ROLE_PERMISSIONS),
    },
    permissions: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    pageVisibility: {
      type: [String],
      default: [],
    },
    auditLog: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true },
);

export const ACTION_ROLES = {
  "items.write": ["Super Admin", "Admin"],
  "warehouses.write": ["Super Admin", "Admin"],
  "inventory.reserve": ["Super Admin", "Admin", "Supervisor", "Store Keeper"],
  "movements.write": ["Super Admin", "Admin", "Supervisor", "Store Keeper"],
  "movements.adjust": ["Super Admin", "Admin", "Supervisor"],
  "materialRequests.review": ["Super Admin", "Admin", "Supervisor", "Store Keeper", "Engineering Executive", "Engineering Manager"],
  "materialRequests.create": ["Super Admin", "Admin", "Technician"],
  "materialRequests.approve": ["Engineering Executive", "Engineering Manager"],
  "materialRequests.issue": ["Super Admin", "Admin", "Store Keeper"],
  "materialRequests.receive": Object.keys(DEFAULT_ROLE_PERMISSIONS),
  "newItemRequests.create": ["Super Admin", "Admin", "Technician"],
  "newItemRequests.review": ["Super Admin", "Admin", "Engineering Executive"],
  "users.write": ["Super Admin", "Admin"],
  "activities": ["Super Admin", "Admin", "Supervisor"],
  "emailDeliveries": ["Super Admin", "Admin"],
};
export const PERMISSION_KEYS = [...Object.keys(DEFAULT_ROLE_PERMISSIONS["Super Admin"]), ...Object.keys(ACTION_ROLES)];
export const defaultRolePermissions = () => Object.fromEntries(Object.entries(DEFAULT_ROLE_PERMISSIONS).map(([role, pages]) => [role, {
  ...pages, ...Object.fromEntries(Object.entries(ACTION_ROLES).map(([key, roles]) => [key, roles.includes(role)])),
}]));

// Seed only missing records. Never restore a revoked permission on startup.
export async function ensureRolePermissions() {
  for (const [role, permissions] of Object.entries(defaultRolePermissions())) {
    await RolePermission.updateOne({ role }, { $setOnInsert: { role, permissions } }, { upsert: true });
  }
}

export function normalizePermissions(permissionSet = {}) {
  const result = {};
  for (const key of PERMISSION_KEYS) {
    result[key] = permissionSet?.[key] === true;
  }
  return result;
}

const RolePermission = mongoose.model("RolePermission", rolePermissionSchema);

export default RolePermission;
