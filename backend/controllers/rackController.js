import mongoose from "mongoose";
import Rack from "../models/Rack.js";
import { recordActivity } from "./activityController.js";
import { locationHasStock } from "./locationHelpers.js";
import Zone from "../models/Zone.js";
import Level from "../models/Level.js";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getActiveZone = async (id) => {
  const zone = await Zone.findById(id).populate("warehouse");
  return zone?.isActive && zone.warehouse?.isActive ? zone : null;
};

const updateRackStatus = async (req, res, isActive) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid rack ID" });
    }
    if (isActive) {
      const current = await Rack.findById(req.params.id);
      if (!current) return res.status(404).json({ message: "Rack not found" });
      if (!(await getActiveZone(current.zone))) return res.status(400).json({ message: "Active zone and warehouse are required" });
    }

    if (!isActive && (await locationHasStock("rack", req.params.id))) {
      return res.status(409).json({ message: "Rack still contains stock. Move or issue the stock before deactivating it" });
    }
    const rack = await Rack.findByIdAndUpdate(req.params.id, { isActive }, { returnDocument: "after", runValidators: true });
    if (rack) await recordActivity(req, isActive ? "rack.activate" : "rack.deactivate", "Rack", rack._id, { rackCode: rack.rackCode });
    if (!rack) return res.status(404).json({ message: "Rack not found" });
    res.status(200).json({ message: `Rack ${isActive ? "activated" : "deactivated"} successfully`, rack });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const createRack = async (req, res) => {
  try {
    const { zone, rackCode, rackName, description } = req.body;
    if (!mongoose.isValidObjectId(zone)) {
      return res.status(400).json({ message: "Invalid zone ID" });
    }
    if (!(await getActiveZone(zone))) {
      return res.status(400).json({ message: "Active zone and warehouse are required" });
    }

    const rack = await Rack.create({ zone, rackCode, rackName, description });
    await recordActivity(req, "rack.create", "Rack", rack._id, { rackCode: rack.rackCode });
    res.status(201).json({ message: "Rack created successfully", rack });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: "Rack code already exists in this zone" });
    res.status(400).json({ message: error.message });
  }
};

export const getRacks = async (req, res) => {
  try {
    const filter = {};
    if (req.query.zone) {
      if (!mongoose.isValidObjectId(req.query.zone)) return res.status(400).json({ message: "Invalid zone ID" });
      filter.zone = req.query.zone;
    }
    if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === "true";
    if (req.query.search) {
      const search = escapeRegex(String(req.query.search));
      filter.$or = [{ rackCode: { $regex: search, $options: "i" } }, { rackName: { $regex: search, $options: "i" } }];
    }

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
    const [racks, total] = await Promise.all([
      Rack.find(filter).populate({ path: "zone", populate: { path: "warehouse", select: "warehouseCode warehouseName" } }).sort({ rackCode: 1 }).skip((page - 1) * limit).limit(limit),
      Rack.countDocuments(filter),
    ]);
    res.status(200).json({ racks, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getRack = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid rack ID" });
    const rack = await Rack.findById(req.params.id).populate({ path: "zone", populate: { path: "warehouse", select: "warehouseCode warehouseName" } });
    if (!rack) return res.status(404).json({ message: "Rack not found" });
    res.status(200).json(rack);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateRack = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid rack ID" });
    const changes = {};
    for (const field of ["zone", "rackCode", "rackName", "description", "isActive"]) {
      if (req.body[field] !== undefined) changes[field] = req.body[field];
    }
    if (changes.isActive !== undefined && typeof changes.isActive !== "boolean") {
      return res.status(400).json({ message: "isActive must be a boolean" });
    }
    if (changes.zone !== undefined) {
      if (!mongoose.isValidObjectId(changes.zone)) return res.status(400).json({ message: "Invalid zone ID" });
      if (!(await getActiveZone(changes.zone))) return res.status(400).json({ message: "Active zone and warehouse are required" });
    }
    if (changes.isActive === true && changes.zone === undefined) {
      const current = await Rack.findById(req.params.id);
      if (!current) return res.status(404).json({ message: "Rack not found" });
      if (!(await getActiveZone(current.zone))) return res.status(400).json({ message: "Active zone and warehouse are required" });
    }
    if (changes.isActive === false && (await locationHasStock("rack", req.params.id))) {
      return res.status(409).json({ message: "Rack still contains stock. Move or issue the stock before deactivating it" });
    }
    const rack = await Rack.findByIdAndUpdate(req.params.id, changes, { returnDocument: "after", runValidators: true });
    if (rack) await recordActivity(req, "rack.update", "Rack", rack._id, { fields: Object.keys(changes) });
    if (!rack) return res.status(404).json({ message: "Rack not found" });
    res.status(200).json({ message: "Rack updated successfully", rack });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: "Rack code already exists in this zone" });
    res.status(400).json({ message: error.message });
  }
};

export const deleteRack = (req, res) => updateRackStatus(req, res, false);
export const deactivateRack = (req, res) => updateRackStatus(req, res, false);
export const reactivateRack = (req, res) => updateRackStatus(req, res, true);
