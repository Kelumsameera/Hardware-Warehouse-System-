import mongoose from "mongoose";
import Level from "../models/Level.js";
import { recordActivity } from "./activityController.js";
import { locationHasStock } from "./locationHelpers.js";
import Rack from "../models/Rack.js";
import Zone from "../models/Zone.js";
import Warehouse from "../models/Warehouse.js";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getActiveRack = async (id) => {
  const rack = await Rack.findById(id);
  if (!rack?.isActive) return null;
  const zone = await Zone.findById(rack.zone);
  if (!zone?.isActive) return null;
  const warehouse = await Warehouse.findById(zone.warehouse);
  return warehouse?.isActive ? rack : null;
};

const updateLevelStatus = async (req, res, isActive) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid level ID" });
    if (isActive) {
      const current = await Level.findById(req.params.id);
      if (!current) return res.status(404).json({ message: "Level not found" });
      if (!(await getActiveRack(current.rack))) return res.status(400).json({ message: "Active rack, zone, and warehouse are required" });
    }
    if (!isActive && (await locationHasStock("level", req.params.id))) {
      return res.status(409).json({ message: "Level still contains stock. Move or issue the stock before deactivating it" });
    }
    const level = await Level.findByIdAndUpdate(req.params.id, { isActive }, { returnDocument: "after", runValidators: true });
    if (level) await recordActivity(req, isActive ? "level.activate" : "level.deactivate", "Level", level._id, { levelCode: level.levelCode });
    if (!level) return res.status(404).json({ message: "Level not found" });
    res.status(200).json({ message: `Level ${isActive ? "activated" : "deactivated"} successfully`, level });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const createLevel = async (req, res) => {
  try {
    const { rack, levelCode, levelName, levelNumber } = req.body;
    if (!mongoose.isValidObjectId(rack)) return res.status(400).json({ message: "Invalid rack ID" });
    if (!(await getActiveRack(rack))) return res.status(400).json({ message: "Active rack, zone, and warehouse are required" });
    const level = await Level.create({ rack, levelCode, levelName, levelNumber });
    await recordActivity(req, "level.create", "Level", level._id, { levelCode: level.levelCode });
    res.status(201).json({ message: "Level created successfully", level });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: "Level code already exists in this rack" });
    res.status(400).json({ message: error.message });
  }
};

export const getLevels = async (req, res) => {
  try {
    const filter = {};
    if (req.query.rack) {
      if (!mongoose.isValidObjectId(req.query.rack)) return res.status(400).json({ message: "Invalid rack ID" });
      filter.rack = req.query.rack;
    }
    if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === "true";
    if (req.query.search) {
      const search = escapeRegex(String(req.query.search));
      filter.$or = [{ levelCode: { $regex: search, $options: "i" } }, { levelName: { $regex: search, $options: "i" } }];
    }
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
    const [levels, total] = await Promise.all([
      Level.find(filter).populate({ path: "rack", populate: { path: "zone", populate: { path: "warehouse", select: "warehouseCode warehouseName" } } }).sort({ levelNumber: 1 }).skip((page - 1) * limit).limit(limit),
      Level.countDocuments(filter),
    ]);
    res.status(200).json({ levels, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getLevel = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid level ID" });
    const level = await Level.findById(req.params.id).populate({ path: "rack", populate: { path: "zone", populate: { path: "warehouse", select: "warehouseCode warehouseName" } } });
    if (!level) return res.status(404).json({ message: "Level not found" });
    res.status(200).json(level);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateLevel = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid level ID" });
    const changes = {};
    for (const field of ["rack", "levelCode", "levelName", "levelNumber", "isActive"]) {
      if (req.body[field] !== undefined) changes[field] = req.body[field];
    }
    if (changes.isActive !== undefined && typeof changes.isActive !== "boolean") {
      return res.status(400).json({ message: "isActive must be a boolean" });
    }
    if (changes.rack !== undefined) {
      if (!mongoose.isValidObjectId(changes.rack)) return res.status(400).json({ message: "Invalid rack ID" });
      if (!(await getActiveRack(changes.rack))) return res.status(400).json({ message: "Active rack, zone, and warehouse are required" });
    }
    if (changes.isActive === true && changes.rack === undefined) {
      const current = await Level.findById(req.params.id);
      if (!current) return res.status(404).json({ message: "Level not found" });
      if (!(await getActiveRack(current.rack))) return res.status(400).json({ message: "Active rack, zone, and warehouse are required" });
    }
    if (changes.isActive === false && (await locationHasStock("level", req.params.id))) {
      return res.status(409).json({ message: "Level still contains stock. Move or issue the stock before deactivating it" });
    }
    const level = await Level.findByIdAndUpdate(req.params.id, changes, { returnDocument: "after", runValidators: true });
    if (level) await recordActivity(req, "level.update", "Level", level._id, { fields: Object.keys(changes) });
    if (!level) return res.status(404).json({ message: "Level not found" });
    res.status(200).json({ message: "Level updated successfully", level });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: "Level code already exists in this rack" });
    res.status(400).json({ message: error.message });
  }
};

export const deleteLevel = (req, res) => updateLevelStatus(req, res, false);
export const deactivateLevel = (req, res) => updateLevelStatus(req, res, false);
export const reactivateLevel = (req, res) => updateLevelStatus(req, res, true);
