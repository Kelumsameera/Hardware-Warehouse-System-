import mongoose from "mongoose";
import Bin from "../models/Bin.js";
import Inventory from "../models/Inventory.js";
import Item from "../models/Item.js";
import Level from "../models/Level.js";
import Rack from "../models/Rack.js";
import Zone from "../models/Zone.js";
import Warehouse from "../models/Warehouse.js";
import { recordActivity } from "./activityController.js";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getActiveLevel = async (id) => {
  const level = await Level.findById(id);
  if (!level?.isActive) return null;
  const rack = await Rack.findById(level.rack);
  if (!rack?.isActive) return null;
  const zone = await Zone.findById(rack.zone);
  if (!zone?.isActive) return null;
  const warehouse = await Warehouse.findById(zone.warehouse);
  return warehouse?.isActive ? level : null;
};

const addBinStatus = async (bins) => {
  const occupiedBins = new Set((await Inventory.find({
    bin: { $in: bins.map((bin) => bin._id) },
    quantity: { $gt: 0 },
  }).distinct("bin")).map(String));
  return bins.map((bin) => {
    const availableCapacity = bin.capacity === null ? null : bin.capacity - bin.usedCapacity;
    const binStatus = !bin.isActive
      ? "Inactive"
      : bin.capacity !== null && availableCapacity <= 0
        ? "Full"
        : occupiedBins.has(String(bin._id))
          ? "Occupied"
          : "Available";
    return { ...bin.toObject(), availableCapacity, binStatus };
  });
};

const updateBinStatus = async (req, res, isActive) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid bin ID" });
  const current = await Bin.findById(req.params.id).select("+inventoryRevision");
  if (!current) return res.status(404).json({ message: "Bin not found" });
  if (current.archivedAt) return res.status(409).json({ message: "Archived bins cannot be reactivated" });
  if (isActive && !(await getActiveLevel(current.level))) return res.status(409).json({ message: "Active parent locations are required" });
  if (!isActive && await Inventory.exists({ bin: current._id, $or: [{ quantity: { $gt: 0 } }, { reservedQuantity: { $gt: 0 } }] })) return res.status(409).json({ message: "A bin containing stock cannot be deactivated" });
  const bin = await Bin.findOneAndUpdate({ _id: current._id,  $expr: { $eq: [{ $ifNull: ["$inventoryRevision", 0] }, current.inventoryRevision || 0] } }, { $set: { isActive }, $inc: { inventoryRevision: 1 } }, { returnDocument: "after" });
  if (!bin) return res.status(409).json({ message: "Bin stock changed; refresh and retry" });
  await recordActivity(req, isActive ? "bin.activate" : "bin.deactivate", "Bin", bin._id, { binCode: bin.binCode });
  res.json({ message: `Bin ${isActive ? "activated" : "deactivated"} successfully`, bin });
};

export const createBin = async (req, res) => {
  try {
    const { level, binCode, binName, binType, capacity, capacityUnit, locationCode, allowedItemGroups } = req.body;
    if (!mongoose.isValidObjectId(level)) return res.status(400).json({ message: "Invalid level ID" });
    if (!(await getActiveLevel(level))) return res.status(400).json({ message: "Active level, rack, zone, and warehouse are required" });
    const bin = await Bin.create({ level, binCode, binName, binType, capacity, capacityUnit, locationCode: locationCode || undefined, allowedItemGroups });
    await recordActivity(req, "bin.create", "Bin", bin._id, { binCode: bin.binCode });
    res.status(201).json({ message: "Bin created successfully", bin });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: "Bin code or location code already exists" });
    res.status(400).json({ message: error.message });
  }
};

export const getBins = async (req, res) => {
  try {
    const filter = {};
    let matchingLevels;
    for (const field of ["level", "rack", "zone", "warehouse"]) {
      if (req.query[field] !== undefined) {
        if (!mongoose.isValidObjectId(req.query[field])) return res.status(400).json({ message: `Invalid ${field} ID` });
        let currentLevels;
        if (field === "level") currentLevels = [req.query.level];
        if (field === "rack") {
          currentLevels = await Level.find({ rack: req.query.rack }).distinct("_id");
        }
        if (field === "zone") {
          const racks = await Rack.find({ zone: req.query.zone }).distinct("_id");
          currentLevels = await Level.find({ rack: { $in: racks } }).distinct("_id");
        }
        if (field === "warehouse") {
          const zones = await Zone.find({ warehouse: req.query.warehouse }).distinct("_id");
          const racks = await Rack.find({ zone: { $in: zones } }).distinct("_id");
          currentLevels = await Level.find({ rack: { $in: racks } }).distinct("_id");
        }
        const currentSet = new Set(currentLevels.map(String));
        matchingLevels = matchingLevels ? matchingLevels.filter((id) => currentSet.has(String(id))) : currentLevels;
      }
    }
    if (matchingLevels) filter.level = { $in: matchingLevels };
    if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === "true";
    if (req.query.search) {
      const search = escapeRegex(String(req.query.search));
      filter.$or = [{ binCode: { $regex: search, $options: "i" } }, { binName: { $regex: search, $options: "i" } }, { locationCode: { $regex: search, $options: "i" } }];
    }
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
    const [binRecords, total] = await Promise.all([
      Bin.find(filter).select("+usedCapacity").populate({ path: "level", populate: { path: "rack", populate: { path: "zone", populate: { path: "warehouse", select: "warehouseCode warehouseName" } } } }).sort({ binCode: 1 }).skip((page - 1) * limit).limit(limit),
      Bin.countDocuments(filter),
    ]);
    const bins = await addBinStatus(binRecords);
    res.status(200).json({ bins, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getBin = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid bin ID" });
    const bin = await Bin.findById(req.params.id).select("+usedCapacity").populate({ path: "level", populate: { path: "rack", populate: { path: "zone", populate: { path: "warehouse", select: "warehouseCode warehouseName" } } } });
    if (!bin) return res.status(404).json({ message: "Bin not found" });
    res.status(200).json((await addBinStatus([bin]))[0]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateBin = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid bin ID" });
    const changes = {};
    for (const field of ["level", "binCode", "binName", "binType", "capacity", "capacityUnit", "locationCode", "allowedItemGroups", "isActive"]) {
      if (req.body[field] !== undefined) changes[field] = req.body[field];
    }
    if (changes.isActive !== undefined && typeof changes.isActive !== "boolean") {
      return res.status(400).json({ message: "isActive must be a boolean" });
    }
    if (changes.allowedItemGroups !== undefined && (!Array.isArray(changes.allowedItemGroups) || changes.allowedItemGroups.some((group) => typeof group !== "string"))) {
      return res.status(400).json({ message: "allowedItemGroups must be an array of strings" });
    }
    if (changes.locationCode === "") changes.locationCode = null;
    if (changes.level !== undefined) {
      if (!mongoose.isValidObjectId(changes.level)) return res.status(400).json({ message: "Invalid level ID" });
      if (!(await getActiveLevel(changes.level))) return res.status(400).json({ message: "Active level, rack, zone, and warehouse are required" });
    }
    const existing = await Bin.findById(req.params.id).select("+usedCapacity +inventoryRevision");
    if (!existing) return res.status(404).json({ message: "Bin not found" });
    if (existing.archivedAt) return res.status(409).json({ message: "Archived bins cannot be edited" });
    if (changes.isActive === true && changes.level === undefined && !(await getActiveLevel(existing.level))) {
      return res.status(400).json({ message: "Active level, rack, zone, and warehouse are required" });
    }
    const hasStock = await Inventory.exists({ bin: existing._id, quantity: { $gt: 0 } });
    if (changes.isActive === false && hasStock) return res.status(409).json({ message: "A bin containing stock cannot be deactivated" });
    if (changes.level !== undefined && String(changes.level) !== String(existing.level) && hasStock) {
      return res.status(409).json({ message: "A bin containing stock cannot be moved to another level" });
    }
    const capacity = changes.capacity !== undefined ? changes.capacity : existing.capacity;
    const capacityUnit = changes.capacityUnit !== undefined ? changes.capacityUnit : existing.capacityUnit;
    if (capacity !== null && capacity !== undefined && !capacityUnit) {
      return res.status(400).json({ message: "Capacity unit is required when capacity is set" });
    }
    if ((changes.capacity !== undefined || changes.capacityUnit !== undefined) && hasStock) {
      if (capacity === null || capacityUnit !== existing.capacityUnit || capacity < existing.usedCapacity) {
        return res.status(409).json({ message: "Capacity cannot be removed, changed to another unit, or reduced below occupied capacity" });
      }
    }
    if (changes.binType === "Dedicated" && existing.binType !== "Dedicated" && hasStock) {
      const itemCount = await Inventory.countDocuments({ bin: existing._id, quantity: { $gt: 0 } });
      if (itemCount > 1) return res.status(409).json({ message: "A bin containing multiple items cannot be changed to Dedicated" });
    }
    if (changes.allowedItemGroups !== undefined && hasStock && changes.allowedItemGroups.length) {
      const stockedItems = await Inventory.find({ bin: existing._id, quantity: { $gt: 0 } }).distinct("item");
      const disallowedItem = await Item.exists({ _id: { $in: stockedItems }, itemGroup: { $nin: changes.allowedItemGroups } });
      if (disallowedItem) return res.status(409).json({ message: "Storage restrictions cannot exclude items already in this bin" });
    }
    const bin = await Bin.findOneAndUpdate({ _id: req.params.id,  $expr: { $eq: [{ $ifNull: ["$inventoryRevision", 0] }, existing.inventoryRevision || 0] } }, { $set: changes, $inc: { inventoryRevision: 1 } }, { returnDocument: "after", runValidators: true });
    if (!bin) return res.status(409).json({ message: "Bin stock changed during editing. Refresh and retry." });
    await recordActivity(req, "bin.update", "Bin", bin._id, { fields: Object.keys(changes) });
    res.status(200).json({ message: "Bin updated successfully", bin });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: "Bin code or location code already exists" });
    res.status(400).json({ message: error.message });
  }
};

export const deleteBin = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid bin ID" });
  const session = await mongoose.startSession();
  try {
    let bin;
    await session.withTransaction(async () => {
      bin = await Bin.findByIdAndUpdate(req.params.id, { $inc: { inventoryRevision: 1 } }, { session, returnDocument: "after" });
      if (!bin) throw Object.assign(new Error("Bin not found"), { status: 404 });
      if (await Inventory.exists({ bin: bin._id, $or: [{ quantity: { $gt: 0 } }, { reservedQuantity: { $gt: 0 } }] }).session(session)) throw Object.assign(new Error("Occupied bins cannot be archived"), { status: 409 });
      bin.isActive = false; bin.gridColumn = null; bin.archivedAt = new Date(); await bin.save({ session });
    });
    await recordActivity(req, "bin.archive", "Bin", bin._id, { binCode: bin.binCode });
    res.json({ message: "Bin archived; history preserved", bin });
  } catch (error) { res.status(error.status || 500).json({ message: error.status ? error.message : "Bin could not be archived" }); }
  finally { await session.endSession(); }
};
export const deactivateBin = (req, res) => updateBinStatus(req, res, false);
export const reactivateBin = (req, res) => updateBinStatus(req, res, true);

export const suggestBins = async (req, res) => {
  try {
    const { item: itemId, warehouse: warehouseId, quantity } = req.query;
    if (!mongoose.isValidObjectId(itemId)) return res.status(400).json({ message: "Valid item ID is required" });
    if (!mongoose.isValidObjectId(warehouseId)) return res.status(400).json({ message: "Valid warehouse ID is required" });
    const amount = Number(quantity);
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ message: "Quantity must be greater than zero" });

    if (!(await Warehouse.findById(warehouseId))?.isActive) return res.status(404).json({ message: "Active warehouse not found" });
    const item = await Item.findById(itemId);
    if (!item?.isActive) return res.status(404).json({ message: "Active item not found" });
    const zones = await Zone.find({ warehouse: warehouseId, isActive: true }).distinct("_id");
    const racks = await Rack.find({ zone: { $in: zones }, isActive: true }).distinct("_id");
    const levels = await Level.find({ rack: { $in: racks }, isActive: true }).distinct("_id");
    const binFilter = { level: { $in: levels }, isActive: true };
    if (req.query.bin !== undefined) {
      if (!mongoose.isValidObjectId(req.query.bin)) return res.status(400).json({ message: "Invalid bin ID" });
      binFilter._id = req.query.bin;
    }
    const bins = await Bin.find(binFilter).select("+usedCapacity");
    const inventory = await Inventory.find({ item: itemId, quantity: { $gt: 0 } }).select("bin quantity");
    const inventoryByBin = new Map(inventory.map((record) => [String(record.bin), record.quantity]));
    const stockRecords = await Inventory.find({
      bin: { $in: bins.map((bin) => bin._id) },
      quantity: { $gt: 0 },
    }).select("bin item");
    const occupiedBins = new Set(stockRecords.map((record) => String(record.bin)));
    const otherStockBins = new Set(stockRecords.filter((record) => String(record.item) !== String(itemId)).map((record) => String(record.bin)));
    const candidates = bins.filter((bin) => {
      if (bin.binType === "Dedicated" && otherStockBins.has(String(bin._id))) return false;
      if (bin.allowedItemGroups.length && !bin.allowedItemGroups.includes(item.itemGroup || "")) return false;
      if (bin.capacity !== null && bin.capacityUnit !== item.uom) return false;
      const remaining = bin.capacity === null ? null : bin.capacity - bin.usedCapacity;
      return remaining === null || remaining >= amount;
    }).sort((a, b) => {
      const aHasItem = inventoryByBin.has(String(a._id));
      const bHasItem = inventoryByBin.has(String(b._id));
      if (aHasItem !== bHasItem) return aHasItem ? -1 : 1;
      const aRemaining = a.capacity === null ? Number.POSITIVE_INFINITY : a.capacity - a.usedCapacity;
      const bRemaining = b.capacity === null ? Number.POSITIVE_INFINITY : b.capacity - b.usedCapacity;
      return aRemaining - bRemaining;
    }).map((bin) => ({
      ...bin.toObject(),
      availableCapacity: bin.capacity === null ? null : bin.capacity - bin.usedCapacity,
      containsItem: inventoryByBin.has(String(bin._id)),
      binStatus: bin.capacity !== null && bin.usedCapacity >= bin.capacity
        ? "Full"
        : occupiedBins.has(String(bin._id))
          ? "Occupied"
          : "Available",
    }));
    res.status(200).json({ bins: candidates });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
