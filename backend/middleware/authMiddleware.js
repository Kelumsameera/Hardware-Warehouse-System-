import jwt from "jsonwebtoken";
import User, { normalizeRoleName } from "../models/User.js";
import RolePermission, { defaultRolePermissions, normalizePermissions } from "../models/RolePermission.js";

export const authenticateToken = async (req, res, next) => {
  const authorization = req.headers.authorization || "";
  const [scheme, token] = authorization.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ message: "Authentication token is required" });
  }
  if (!process.env.JWT_SECRET) {
    return res.status(503).json({ message: "Authentication is not configured" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (typeof payload !== "object" || typeof payload.sub !== "string") {
      return res.status(401).json({ message: "Invalid authentication token" });
    }
    const user = await User.findById(payload.sub).select("fullName email role isActive");
    if (!user?.isActive) return res.status(401).json({ message: "User account is inactive or unavailable" });
    const normalizedRole = normalizeRoleName(user.role) || user.role;
    req.user = { userId: String(user._id), fullName: user.fullName, email: user.email, role: normalizedRole, sessionExpiresAt: payload.exp * 1000 };
    return next();
  } catch (error) {
    if (error.name === "TokenExpiredError" || error.name === "JsonWebTokenError") {
      return res.status(401).json({ message: "Invalid or expired authentication token" });
    }
    return res.status(500).json({ message: "Authentication could not be completed" });
  }
};

export const getEffectivePermissions = async (roleName) => {
  const currentRole = normalizeRoleName(roleName) || roleName || "Viewer";
  const record = await RolePermission.findOne({ role: currentRole }).lean();
  return normalizePermissions(record?.permissions || {});
};

export const requireRoles = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Authentication is required" });
  const allowed = new Set(roles.map((role) => normalizeRoleName(role) || role));
  const current = normalizeRoleName(req.user.role) || req.user.role;
  if (!allowed.has(current)) return res.status(403).json({ message: "Insufficient permissions" });
  return next();
};

export const requirePermission = (pageKey) => async (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Authentication is required" });
  const currentRole = normalizeRoleName(req.user.role) || req.user.role;

  let permissions;
  try { permissions = await getEffectivePermissions(currentRole); }
  catch { return res.status(503).json({ message: "Permissions are unavailable" }); }
  req.user.permissions = permissions;
  const parent = pageKey.includes(".") ? pageKey.split(".")[0] : null;
  if (permissions[pageKey] === true && (!parent || permissions[parent] === true)) return next();
  return res.status(403).json({ message: `Access to ${pageKey} is denied for this role` });
};

export const requireAnyPermission = (...pageKeys) => async (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Authentication is required" });
  const currentRole = normalizeRoleName(req.user.role) || req.user.role;

  let permissions;
  try { permissions = await getEffectivePermissions(currentRole); }
  catch { return res.status(503).json({ message: "Permissions are unavailable" }); }
  req.user.permissions = permissions;
  if (pageKeys.some((key) => Boolean(permissions[key]))) return next();
  return res.status(403).json({ message: `Access denied. Required permissions: ${pageKeys.join(", ")}` });
};
