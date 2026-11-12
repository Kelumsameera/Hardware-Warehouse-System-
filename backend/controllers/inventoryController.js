import mongoose from "mongoose";
import Activity from "../models/Activity.js";
import Bin from "../models/Bin.js";
import Inventory from "../models/Inventory.js";
import Item from "../models/Item.js";
import Level from "../models/Level.js";
import Rack from "../models/Rack.js";
import Zone from "../models/Zone.js";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const aggregateStock = () => [
  { $lookup: { from: "bins", localField: "bin", foreignField: "_id", as: "bin" } },
  { $unwind: "$bin" },
  { $lookup: { from: "levels", localField: "bin.level", foreignField: "_id", as: "level" } },
  { $unwind: "$level" },
  { $lookup: { from: "racks", localField: "level.rack", foreignField: "_id", as: "rack" } },
  { $unwind: "$rack" },
  { $lookup: { from: "zones", localField: "rack.zone", foreignField: "_id", as: "zone" } },
  { $unwind: "$zone" },
  { $lookup: { from: "warehouses", localField: "zone.warehouse", foreignField: "_id", as: "warehouse" } },
  { $unwind: "$warehouse" },
  {
    $group: {
      _id: { item: "$item", warehouse: "$warehouse._id" },
      quantity: { $sum: "$quantity" },
      reservedQuantity: { $sum: "$reservedQuantity" },
    },
  },
  {
    $project: {
      _id: 0,
      item: "$_id.item",
      warehouse: "$_id.warehouse",
      quantity: 1,
      reservedQuantity: 1,
      availableQuantity: { $subtract: ["$quantity", "$reservedQuantity"] },
    },
  },
];

export const getInventory = async (req, res) => {
  try {
    const filter = {};
    for (const field of ["item", "bin"]) {
      if (req.query[field] !== undefined) {
        if (!mongoose.isValidObjectId(req.query[field])) return res.status(400).json({ message: `Invalid ${field} ID` });
        filter[field] = req.query[field];
      }
    }

    let binIds;
    for (const field of ["level", "rack", "zone", "warehouse"]) {
      if (req.query[field] === undefined) continue;
      if (!mongoose.isValidObjectId(req.query[field])) return res.status(400).json({ message: `Invalid ${field} ID` });
      let currentBinIds;
      if (field === "level") currentBinIds = await Bin.find({ level: req.query.level }).distinct("_id");
      if (field === "rack") {
        const levels = await Level.find({ rack: req.query.rack }).distinct("_id");
        currentBinIds = await Bin.find({ level: { $in: levels } }).distinct("_id");
      }
      if (field === "zone") {
        const racks = await Rack.find({ zone: req.query.zone }).distinct("_id");
        const levels = await Level.find({ rack: { $in: racks } }).distinct("_id");
        currentBinIds = await Bin.find({ level: { $in: levels } }).distinct("_id");
      }
      if (field === "warehouse") {
        const zones = await Zone.find({ warehouse: req.query.warehouse }).distinct("_id");
        const racks = await Rack.find({ zone: { $in: zones } }).distinct("_id");
        const levels = await Level.find({ rack: { $in: racks } }).distinct("_id");
        currentBinIds = await Bin.find({ level: { $in: levels } }).distinct("_id");
      }
      const currentSet = new Set(currentBinIds.map(String));
      binIds = binIds ? binIds.filter((id) => currentSet.has(String(id))) : currentBinIds;
    }
    if (binIds) {
      filter.bin = typeof filter.bin === "string"
        ? { $in: binIds.filter((id) => String(id) === filter.bin) }
        : { $in: binIds };
    }

    if (req.query.search) {
      const regex = new RegExp(escapeRegex(String(req.query.search)), "i");
      const items = await Item.find({ $or: [{ itemCode: regex }, { description: regex }] }).distinct("_id");
      const selectedItem = filter.item;
      filter.item = { $in: selectedItem ? items.filter((id) => String(id) === String(selectedItem)) : items };
    }

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
    const [records, total] = await Promise.all([
      Inventory.find(filter).populate("item", "itemCode description uom").populate({ path: "bin", populate: { path: "level", populate: { path: "rack", populate: { path: "zone", populate: { path: "warehouse", select: "warehouseCode warehouseName" } } } } }).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit),
      Inventory.countDocuments(filter),
    ]);
    const inventory = records.map((record) => ({ ...record.toObject(), availableQuantity: record.quantity - record.reservedQuantity }));
    res.status(200).json({ inventory, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getInventorySummary = async (req, res, overrides = {}) => {
  try {
    const itemId = overrides.item || req.query.item;
    const warehouseId = overrides.warehouse || req.query.warehouse;
    for (const [field, id] of [["item", itemId], ["warehouse", warehouseId]]) {
      if (id !== undefined && !mongoose.isValidObjectId(id)) {
        return res.status(400).json({ message: `Invalid ${field} ID` });
      }
    }
    const pipeline = aggregateStock();
    if (itemId) pipeline.unshift({ $match: { item: new mongoose.Types.ObjectId(itemId) } });
    if (warehouseId) {
      const groupIndex = pipeline.findIndex((stage) => stage.$group);
      pipeline.splice(groupIndex, 0, { $match: { "warehouse._id": new mongoose.Types.ObjectId(warehouseId) } });
    }
    const summary = await Inventory.aggregate(pipeline);
    res.status(200).json({ summary });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getWarehouseStock = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid warehouse ID" });
  return getInventorySummary(req, res, { warehouse: req.params.id });
};

export const getItemStock = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid item ID" });
  return getInventorySummary(req, res, { item: req.params.id });
};

export const getInventoryRecord = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid inventory ID" });
    const record = await Inventory.findById(req.params.id).populate("item", "itemCode description uom").populate("bin");
    if (!record) return res.status(404).json({ message: "Inventory record not found" });
    res.status(200).json({ ...record.toObject(), availableQuantity: record.quantity - record.reservedQuantity });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getStockSummary = async (req, res) => {
  try {
    const summary = await Inventory.aggregate([
      { $group: { _id: null, itemBinCount: { $sum: 1 }, quantity: { $sum: "$quantity" }, reservedQuantity: { $sum: "$reservedQuantity" } } },
      { $project: { _id: 0, itemBinCount: 1, quantity: 1, reservedQuantity: 1, availableQuantity: { $subtract: ["$quantity", "$reservedQuantity"] } } },
    ]);
    res.status(200).json(summary[0] || { itemBinCount: 0, quantity: 0, reservedQuantity: 0, availableQuantity: 0 });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const changeReservation = async (req, res, direction) => {
  let session;
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid inventory ID" });
    const quantity = Number(req.body.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ message: "Quantity must be a positive number" });
    session = await mongoose.startSession();
    let updated;
    await session.withTransaction(async () => {
      const filter = { _id: req.params.id };
      if (direction === "reserve") {
        filter.$expr = { $gte: [{ $subtract: ["$quantity", "$reservedQuantity"] }, quantity] };
      } else {
        filter.reservedQuantity = { $gte: quantity };
      }
      updated = await Inventory.findOneAndUpdate(
        filter,
        { $inc: { reservedQuantity: direction === "reserve" ? quantity : -quantity } },
        { returnDocument: "after", session },
      );
      if (!updated) throw Object.assign(new Error(direction === "reserve" ? "Insufficient available stock to reserve" : "Insufficient reserved stock to release"), { status: 409 });
      await Activity.create([{
        user: req.user.userId,
        action: `inventory.${direction}`,
        entityType: "Inventory",
        entityId: updated._id,
        details: { quantity },
        ipAddress: req.ip,
      }], { session });
    });
    res.status(200).json({ message: `Stock ${direction === "reserve" ? "reserved" : "released"} successfully`, inventory: { ...updated.toObject(), availableQuantity: updated.quantity - updated.reservedQuantity } });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    if (error.code === 20 || error.codeName === "IllegalOperation" || /transaction numbers are only allowed|does not support transactions|replica set/i.test(error.message || "")) {
      return res.status(503).json({ message: "Reservations require MongoDB replica set or transaction-capable configuration" });
    }
    res.status(500).json({ message: "Stock reservation could not be completed" });
  } finally {
    if (session) await session.endSession();
  }
};
