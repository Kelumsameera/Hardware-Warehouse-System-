import crypto from "node:crypto";
import Notification from "../models/Notification.js";
import RolePermission from "../models/RolePermission.js";
import User, { normalizeRoleName, ROLE_ALIASES } from "../models/User.js";
import { getEffectivePermissions } from "../middleware/authMiddleware.js";
import { emitNotification } from "../socket.js";
import { enqueueEmail } from "./emailService.js";

export async function getRecipientUsers({ userIds = [], roles = [], rolePermissions = [] } = {}) {
  if (rolePermissions.length) {
    const definitions = await RolePermission.find({ $expr: { $or: rolePermissions.map((key) => ({ $eq: [{ $getField: { field: { $literal: key }, input: "$permissions" } }, true] })) } }).select("role").lean();
    roles = [...roles, ...definitions.map((definition) => definition.role)];
  }
  const or = [];
  if (userIds.length) or.push({ _id: { $in: userIds } });
  if (roles.length) {
    const canonical = new Set(roles.map((role) => normalizeRoleName(role)).filter(Boolean));
    const aliases = Object.keys(ROLE_ALIASES).filter((alias) => canonical.has(ROLE_ALIASES[alias]));
    or.push({ role: { $in: [...canonical, ...aliases] } });
  }
  return or.length ? User.find({ isActive: true, $or: or }).select("_id fullName email role").collation({ locale: "en", strength: 2 }) : [];
}
export async function createNotifications({ userIds = [], roles = [], rolePermissions = [], title, message, type = "info", link = null, sourceType = null, sourceId = null, metadata = {}, sendEmail = false }) {
  const recipients = await getRecipientUsers({ userIds, roles, rolePermissions });
  const created = [];
  const requiredPage = sourceType?.toLowerCase().includes("newitem") ? "newItemRequests" : sourceType?.toLowerCase().includes("material") ? "materialRequests" : null;
  for (const user of recipients) {
    const permissions = await getEffectivePermissions(user.role);
    if (!permissions.notifications || (requiredPage && !permissions[requiredPage])) continue;
    const dedupeKey = sourceType && sourceId ? crypto.createHash("sha256").update(JSON.stringify([String(user._id), sourceType, String(sourceId), title, message, metadata.eventKey || null])).digest("hex") : undefined;
    let item;
    try { item = await Notification.create({ user: user._id, title, message, type, link, sourceType, sourceId, metadata, dedupeKey, emailRequested: sendEmail }); }
    catch (error) { if (error.code === 11000) continue; throw error; }
    created.push(item);
    await emitNotification(user._id, item).catch(() => false);
    // SMTP is exclusively handled by the worker, outside warehouse transactions.
    if (sendEmail) await enqueueEmail(item).catch(() => console.error("Email enqueue deferred to reconciliation"));
  }
  return created;
}
export async function notifyUsers(options) {
  try { return await createNotifications(options); }
  catch { console.error("Notification delivery unavailable; warehouse operation preserved"); return []; }
}
