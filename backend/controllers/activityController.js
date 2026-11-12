import mongoose from "mongoose";
import Activity from "../models/Activity.js";

// Records an audit entry for a master-data change. The main operation has already
// succeeded, so a logging failure is reported in the server log instead of failing the request.
export const recordActivity = async (req, action, entityType, entityId, details = {}) => {
  try {
    await Activity.create({ user: req.user.userId, action, entityType, entityId, details, ipAddress: req.ip });
  } catch (error) {
    console.error(`Activity log failed for ${action}:`, error.message);
  }
};

export const getActivities = async (req, res) => {
  try {
    const filter = {};
    for (const field of ["user", "entityId"]) {
      if (req.query[field] !== undefined) {
        if (!mongoose.isValidObjectId(req.query[field])) return res.status(400).json({ message: `Invalid ${field} ID` });
        filter[field] = req.query[field];
      }
    }
    if (req.query.action) filter.action = String(req.query.action).slice(0, 120);
    if (req.query.entityType) filter.entityType = String(req.query.entityType).slice(0, 80);
    if (req.query.startDate || req.query.endDate) {
      filter.createdAt = {};
      if (req.query.startDate) {
        const startDate = new Date(req.query.startDate);
        if (Number.isNaN(startDate.getTime())) return res.status(400).json({ message: "Invalid startDate" });
        filter.createdAt.$gte = startDate;
      }
      if (req.query.endDate) {
        const endDate = new Date(req.query.endDate);
        if (Number.isNaN(endDate.getTime())) return res.status(400).json({ message: "Invalid endDate" });
        filter.createdAt.$lte = endDate;
      }
      if (filter.createdAt.$gte && filter.createdAt.$lte && filter.createdAt.$gte > filter.createdAt.$lte) {
        return res.status(400).json({ message: "startDate must be before endDate" });
      }
    }
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const [activities, total] = await Promise.all([
      Activity.find(filter).populate("user", "fullName email role").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      Activity.countDocuments(filter),
    ]);
    res.status(200).json({ activities, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
