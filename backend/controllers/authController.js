import RolePermission from "../models/RolePermission.js";
import { getEffectivePermissions } from "../middleware/authMiddleware.js";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import Activity from "../models/Activity.js";
import User, { USER_ROLES, normalizeRoleName } from "../models/User.js";

const createToken = (user) => {
  if (!process.env.JWT_SECRET) return null;
  const normalizedRole = normalizeRoleName(user.role) || user.role;
  return jwt.sign({ role: normalizedRole }, process.env.JWT_SECRET, { subject: String(user._id), expiresIn: "8h" });
};

const validateCredentials = (body = {}) => {
  const { fullName, email, password } = body || {};
  if (typeof fullName !== "string" || !fullName.trim()) return "Full name is required";
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "A valid email is required";
  if (typeof password !== "string" || password.length < 10) return "Password must be at least 10 characters";
  return null;
};

const sameToken = (provided, expected) => {
  if (typeof provided !== "string" || !expected) return false;
  const providedHash = crypto.createHash("sha256").update(provided).digest();
  const expectedHash = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(providedHash, expectedHash);
};

const publicUser = (user) => ({
  id: String(user._id),
  fullName: user.fullName,
  email: user.email,
  role: normalizeRoleName(user.role) || user.role,
  isActive: user.isActive,
});

export const bootstrapAdmin = async (req, res) => {
  try {
    if (!process.env.JWT_SECRET || !process.env.INITIAL_ADMIN_SETUP_TOKEN) {
      return res.status(503).json({ message: "Initial administrator setup is not configured" });
    }
    if (!sameToken(req.get("x-setup-token"), process.env.INITIAL_ADMIN_SETUP_TOKEN)) {
      return res.status(403).json({ message: "Invalid setup token" });
    }
    if (await User.exists({})) return res.status(409).json({ message: "Initial administrator has already been created" });
    const invalid = validateCredentials(req.body);
    if (invalid) return res.status(400).json({ message: invalid });

    const user = await User.create({
      fullName: req.body.fullName.trim(),
      email: req.body.email.trim().toLowerCase(),
      password: req.body.password,
      role: "Super Admin",
      bootstrapKey: "initial-admin",
    });
    await Activity.create({
      user: user._id,
      action: "auth.bootstrap",
      entityType: "User",
      entityId: user._id,
      details: { role: user.role },
      ipAddress: req.ip,
    });
    res.status(201).json({ user: publicUser(user), token: createToken(user) });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: "Initial administrator has already been created" });
    if (error.name === "ValidationError") return res.status(400).json({ message: error.message });
    res.status(500).json({ message: error.message });
  }
};

export const login = async (req, res) => {
  try {
    if (!process.env.JWT_SECRET) return res.status(503).json({ message: "Authentication is not configured" });
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const user = await User.findOne({ email }).select("+password");
    if (!user?.isActive || !password || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }
    const token = createToken(user);
    await Activity.create({
      user: user._id,
      action: "auth.login",
      entityType: "User",
      entityId: user._id,
      ipAddress: req.ip,
    });
    res.status(200).json({ user: publicUser(user), token });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const privilegedRole = async (role) => {
  if (["Super Admin", "Admin"].includes(normalizeRoleName(role))) return true;
  const permissions = await getEffectivePermissions(role);
  return ["users.write", "warehouses.write", "items.write", "movements.adjust", "materialRequests.approve", "newItemRequests.review", "emailDeliveries"].some((key) => permissions[key]);
};

const canDelegateRole = async (actor, role) => {
  if (actor.role === "Super Admin") return true;
  if (await privilegedRole(role)) return false;
  const permissions = await getEffectivePermissions(role);
  return Object.entries(permissions).every(([key, enabled]) => !enabled || actor.permissions?.[key] === true);
};

export const getAssignableRoles = async (req, res) => {
  const roles = [];
  for (const role of USER_ROLES) if (await canDelegateRole(req.user, role)) roles.push(role);
  res.json({ roles });
};

export const createUser = async (req, res) => {
  try {
    const invalid = validateCredentials(req.body);
    if (invalid) return res.status(400).json({ message: invalid });
    const role = normalizeRoleName(req.body.role) || req.body.role;
    if (!role || !USER_ROLES.includes(role)) return res.status(400).json({ message: "Valid role is required" });
    if (!(await canDelegateRole(req.user, role))) {
      return res.status(403).json({ message: "Only a Super Admin can assign this role" });
    }
    const user = await User.create({
      fullName: req.body.fullName.trim(),
      email: req.body.email.trim().toLowerCase(),
      password: req.body.password,
      role,
    });
    await Activity.create({
      user: req.user.userId,
      action: "user.create",
      entityType: "User",
      entityId: user._id,
      details: { role },
      ipAddress: req.ip,
    });
    res.status(201).json({ message: "User created successfully", user: publicUser(user) });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: "Email address already exists" });
    if (error.name === "ValidationError") return res.status(400).json({ message: error.message });
    res.status(500).json({ message: error.message });
  }
};

export const getUsers = async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
    const filter = {};
    if (req.query.role) filter.role = req.query.role;
    if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === "true";
    if (typeof req.query.search === "string" && req.query.search.trim()) {
      const search = req.query.search.trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [{ fullName: { $regex: search, $options: "i" } }, { email: { $regex: search, $options: "i" } }];
    }
    const [users, total] = await Promise.all([
      User.find(filter).select("fullName email role isActive createdAt").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      User.countDocuments(filter),
    ]);
    res.status(200).json({ users, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const failAccount = (status, message) => Object.assign(new Error(message), { status });
// All privileged account changes share a transaction lock. Two administrators
// cannot concurrently remove the last Super Admin or edit a just-promoted user.
const accountTransaction = (req, work) => mongoose.connection.transaction(async (session) => {
  await RolePermission.updateOne({ role: "Super Admin" }, { $inc: { accountRevision: 1 } }, { session });
  const actor = await User.findById(req.user.userId).select("role isActive").session(session);
  if (!actor?.isActive || normalizeRoleName(actor.role) !== req.user.role) throw failAccount(403, "Your account changed. Sign in again.");
  return work(session);
});
export const setUserActive = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid user ID" });
    if (typeof req.body.isActive !== "boolean") return res.status(400).json({ message: "isActive must be a boolean" });
    if (req.params.id === req.user.userId && !req.body.isActive) return res.status(400).json({ message: "You cannot deactivate your own account" });
    const user = await accountTransaction(req, async (session) => {
      const current = await User.findById(req.params.id).session(session);
      if (!current) throw failAccount(404, "User not found");
      const role = normalizeRoleName(current.role) || current.role;
      if (!(await canDelegateRole(req.user, role))) throw failAccount(403, "Only a Super Admin can manage privileged accounts");
      if (!req.body.isActive && role === "Super Admin" && await User.countDocuments({ role: "Super Admin", isActive: true }).session(session) <= 1) throw failAccount(409, "The last active Super Admin cannot be deactivated");
      current.isActive = req.body.isActive; await current.save({ session });
      await Activity.create([{ user: req.user.userId, action: current.isActive ? "user.activate" : "user.deactivate", entityType: "User", entityId: current._id, details: { role }, ipAddress: req.ip }], { session });
      return current;
    });
    res.json({ message: `User ${user.isActive ? "activated" : "deactivated"} successfully`, user: publicUser(user) });
  } catch (error) { res.status(error.status || 500).json({ message: error.status ? error.message : "Account status could not be updated" }); }
};

export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("fullName email role isActive createdAt");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.status(200).json({ user: { ...publicUser(user), createdAt: user.createdAt, permissions: await getEffectivePermissions(req.user.role) } });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const changePassword = async (req, res) => {
  try {
    const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
    const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
    if (!currentPassword) return res.status(400).json({ message: "Current password is required" });
    if (newPassword.length < 10) return res.status(400).json({ message: "New password must be at least 10 characters" });
    if (newPassword === currentPassword) return res.status(400).json({ message: "New password must be different from the current password" });

    const user = await User.findById(req.user.userId).select("+password");
    if (!user || !(await user.comparePassword(currentPassword))) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }
    user.password = newPassword;
    await user.save();
    await Activity.create({ user: user._id, action: "auth.password.change", entityType: "User", entityId: user._id, ipAddress: req.ip });
    res.status(200).json({ message: "Password changed successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateUser = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid user ID" });
    const { fullName, password } = req.body || {};
    const role = req.body?.role === undefined ? undefined : normalizeRoleName(req.body.role);
    if (fullName !== undefined && (typeof fullName !== "string" || !fullName.trim())) return res.status(400).json({ message: "Full name is required" });
    if (role !== undefined && !USER_ROLES.includes(role)) return res.status(400).json({ message: "Valid role is required" });
    if (password !== undefined && (typeof password !== "string" || password.length < 10)) return res.status(400).json({ message: "Password must be at least 10 characters" });
    const user = await accountTransaction(req, async (session) => {
      const current = await User.findById(req.params.id).select("+password").session(session);
      if (!current) throw failAccount(404, "User not found");
      const previousRole = normalizeRoleName(current.role) || current.role;
      if (!(await canDelegateRole(req.user, previousRole)) || (role !== undefined && !(await canDelegateRole(req.user, role)))) throw failAccount(403, "Only a Super Admin can manage privileged accounts");
      if (role !== undefined && role !== previousRole && String(current._id) === req.user.userId) throw failAccount(400, "You cannot change your own role");
      if (role !== undefined && previousRole === "Super Admin" && role !== "Super Admin" && current.isActive && await User.countDocuments({ role: "Super Admin", isActive: true }).session(session) <= 1) throw failAccount(409, "The last active Super Admin cannot be assigned another role");
      if (password !== undefined && String(current._id) === req.user.userId) throw failAccount(400, "Use Settings to change your own password");
      const changed = [];
      if (fullName !== undefined && fullName.trim() !== current.fullName) { current.fullName = fullName.trim(); changed.push("fullName"); }
      if (role !== undefined && role !== previousRole) { current.role = role; changed.push("role"); }
      if (password !== undefined) { current.password = password; changed.push("password"); }
      if (changed.length) await current.save({ session });
      await Activity.create([{ user: req.user.userId, action: "user.update", entityType: "User", entityId: current._id, details: { fields: changed, previousRole, role: current.role }, ipAddress: req.ip }], { session });
      return current;
    });
    res.json({ message: "User updated successfully", user: publicUser(user) });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    if (error.name === "ValidationError") return res.status(400).json({ message: error.message });
    res.status(500).json({ message: "User could not be updated" });
  }
};
