import mongoose from "mongoose";
import Notification from "../models/Notification.js";

const normalizeLimit = (value, fallback = 20) => {
  const limit = Number.parseInt(value, 10);
  if (!Number.isFinite(limit) || limit < 1) return fallback;
  return Math.min(limit, 100);
};

const visibleFilter = (req) => ({ user: req.user.userId, sourceType: { $nin: [
  ...(!req.user.permissions?.materialRequests ? ["MaterialRequest"] : []),
  ...(!req.user.permissions?.newItemRequests ? ["NewItemRequest"] : []),
] } });

export const listNotifications = async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = normalizeLimit(req.query.limit, 20);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      Notification.find(visibleFilter(req)).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Notification.countDocuments(visibleFilter(req)),
    ]);

    res.status(200).json({
      notifications: items,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      unreadCount: await Notification.countDocuments({ ...visibleFilter(req), readAt: null }),
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Notifications could not be loaded" });
  }
};

export const unreadCount = async (req, res) => {
  try {
    const count = await Notification.countDocuments({ ...visibleFilter(req), readAt: null });
    res.status(200).json({ unreadCount: count });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unread count could not be loaded" });
  }
};

export const markNotificationRead = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid notification ID" });
    }

    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, ...visibleFilter(req), readAt: null },
      { $set: { readAt: new Date() } },
      { returnDocument: "after" },
    );

    if (!notification) return res.status(404).json({ message: "Notification not found" });
    return res.status(200).json({ notification });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Notification could not be marked read" });
  }
};

export const markAllNotificationsRead = async (req, res) => {
  try {
    const result = await Notification.updateMany({ ...visibleFilter(req), readAt: null }, { $set: { readAt: new Date() } });
    res.status(200).json({ updated: result.modifiedCount || 0 });
  } catch (error) {
    res.status(500).json({ message: error.message || "Notifications could not be marked read" });
  }
};
