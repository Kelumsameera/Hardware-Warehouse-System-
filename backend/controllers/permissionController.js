import mongoose from "mongoose";
import RolePermission, { defaultRolePermissions, normalizePermissions, PERMISSION_KEYS, ensureRolePermissions } from "../models/RolePermission.js";
import Activity from "../models/Activity.js";

const PAGE_KEYS = PERMISSION_KEYS;

const SAFE_SUPER_ADMIN = "Super Admin";

const getDefaultRoleConfig = async (role) => {
  const existing = await RolePermission.findOne({ role }).lean();
  if (existing) return existing;
  const defaults = defaultRolePermissions()[role] || {};
  const permissionRow = await RolePermission.create({
    role,
    permissions: normalizePermissions(defaults),
    pageVisibility: Object.entries(defaults).filter(([, enabled]) => enabled).map(([key]) => key),
    auditLog: [],
  });
  return permissionRow.toObject();
};

export const getRolePermissions = async (req, res) => {
  try {
    await ensureRolePermissions();
    const allRoles = Object.keys(defaultRolePermissions());
    const records = await RolePermission.find({ role: { $in: allRoles } }).lean();
    const keyed = new Map(records.map((item) => [item.role, item]));
    const payload = allRoles.map((role) => {
      const record = keyed.get(role) || { role, permissions: normalizePermissions(defaultRolePermissions()[role]), pageVisibility: [], auditLog: [] };
      return {
        role,
        permissions: normalizePermissions(record.permissions || defaultRolePermissions()[role]),
        pageVisibility: Array.isArray(record.pageVisibility) ? record.pageVisibility : [],
        updatedAt: record.updatedAt || null,
      };
    });
    res.status(200).json({ roles: payload });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const saveRolePermissions = async (req, res) => {
  try {
    const role = typeof req.params.role === "string" ? req.params.role.trim() : "";
    const payload = req.body || {};
    if (!payload.permissions || typeof payload.permissions !== "object" || Array.isArray(payload.permissions) || Object.entries(payload.permissions).some(([key, value]) => !PERMISSION_KEYS.includes(key) || typeof value !== "boolean")) {
      return res.status(400).json({ message: "Permissions must contain known keys and boolean values" });
    }
    if (!role || !Object.prototype.hasOwnProperty.call(defaultRolePermissions(), role)) {
      return res.status(400).json({ message: "Invalid role" });
    }
    if (role === SAFE_SUPER_ADMIN && req.user.role !== SAFE_SUPER_ADMIN) {
      return res.status(403).json({ message: "Only a Super Admin can change Super Admin permissions" });
    }

    const previous = await getDefaultRoleConfig(role);
    if (role === SAFE_SUPER_ADMIN && ["users", "users.write", "settings"].some((key) => payload.permissions[key] !== true)) return res.status(400).json({ message: "Super Admin recovery permissions cannot be revoked" });
    const nextPermissions = normalizePermissions(payload.permissions);
    const visiblePages = Array.isArray(payload.pageVisibility)
      ? [...new Set(payload.pageVisibility.filter((key) => PAGE_KEYS.includes(key)))]
      : Object.entries(nextPermissions).filter(([, enabled]) => enabled).map(([key]) => key);

    const supportedPermissionKeys = new Set(PAGE_KEYS);
    for (const key of Object.keys(nextPermissions)) {
      if (!supportedPermissionKeys.has(key)) delete nextPermissions[key];
    }
    for (const key of PAGE_KEYS) {
      if (!(key in nextPermissions)) nextPermissions[key] = Boolean(role === SAFE_SUPER_ADMIN || (defaultRolePermissions()[role] && defaultRolePermissions()[role][key]));
    }

    const record = await RolePermission.findOneAndUpdate({ role, updatedAt: previous.updatedAt }, {
      role,
      permissions: nextPermissions,
      pageVisibility: visiblePages,
      $push: { auditLog: JSON.stringify({ actor: req.user.userId, at: new Date(), previous: previous.permissions, next: nextPermissions }) },
    }, { returnDocument: "after", runValidators: true });

    if (!record) return res.status(409).json({ message: "Permissions changed concurrently. Reload before saving." });
    await Activity.create({
      user: req.user.userId,
      action: "permission.update",
      entityType: "RolePermission",
      entityId: record._id,
      details: {
        role,
        previousPermissions: previous.permissions || {},
        nextPermissions,
        previousPageVisibility: previous.pageVisibility || [],
        nextPageVisibility: visiblePages,
      },
      ipAddress: req.ip,
    });

    res.status(200).json({ message: "Permissions updated", role, permissions: normalizePermissions(nextPermissions), pageVisibility: visiblePages });
  } catch (error) {
    if (error.name === "ValidationError") return res.status(400).json({ message: error.message });
    return res.status(500).json({ message: error.message });
  }
};

export const getPermissionAuditLog = async (req, res) => {
  try {
    const logs = await Activity.find({ action: "permission.update" }).sort({ createdAt: -1 }).limit(50).lean();
    res.status(200).json({ entries: logs });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const hasRolePermission = async (user, pageKey) => {
  if (!user || !user.role) return false;
  const permissionRow = await RolePermission.findOne({ role: user.role }).lean();
  const permissions = permissionRow?.permissions || {};
  return Boolean(permissions[pageKey]);
};

export const resolvePageAccess = async (user) => {
  if (!user || !user.role) return {};
  const permissionRow = await RolePermission.findOne({ role: user.role }).lean();
  const permissions = permissionRow?.permissions || {};
  return normalizePermissions(permissions);
};
