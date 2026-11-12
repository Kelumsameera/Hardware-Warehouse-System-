import mongoose from "mongoose";
import Activity from "../models/Activity.js";
import Bin from "../models/Bin.js";
import Inventory from "../models/Inventory.js";
import Item from "../models/Item.js";
import Level from "../models/Level.js";
import Rack from "../models/Rack.js";
import StockMovement from "../models/StockMovement.js";
import Warehouse from "../models/Warehouse.js";
import Zone from "../models/Zone.js";
import { getBinIdsUnder } from "./locationHelpers.js";

export const fail = (status, message) => Object.assign(new Error(message), { status });

export const validateBinHierarchy = async (binId, session) => {
  const bin = await Bin.findById(binId).select("+usedCapacity").session(session);
  if (!bin?.isActive) throw fail(400, "Active bin not found");
  const level = await Level.findById(bin.level).session(session);
  if (!level?.isActive) throw fail(400, "Bin level is inactive");
  const rack = await Rack.findById(level.rack).session(session);
  if (!rack?.isActive) throw fail(400, "Bin rack is inactive");
  const zone = await Zone.findById(rack.zone).session(session);
  if (!zone?.isActive) throw fail(400, "Bin zone is inactive");
  const warehouse = await Warehouse.findById(zone.warehouse).session(session);
  if (!warehouse?.isActive) throw fail(400, "Bin warehouse is inactive");
  return bin;
};

export const touchBin = async (bin, amount, direction, item, session) => {
  if (bin.allowedItemGroups.length && !bin.allowedItemGroups.includes(item.itemGroup || "")) {
    throw fail(400, "Item group is not allowed in this bin");
  }
  if (bin.capacity !== null && bin.capacity !== undefined && bin.capacityUnit !== item.uom) {
    throw fail(400, `Bin capacity is measured in ${bin.capacityUnit}; item unit is ${item.uom}`);
  }

  const delta = direction === "in" ? amount : -amount;
  const filter = { _id: bin._id, isActive: true };
  if (bin.capacity !== null && bin.capacity !== undefined) {
    filter.$expr = direction === "in"
      ? { $lte: [{ $add: [{ $ifNull: ["$usedCapacity", 0] }, amount] }, "$capacity"] }
      : { $gte: [{ $ifNull: ["$usedCapacity", 0] }, amount] };
  }
  const increment = { inventoryRevision: 1 };
  if (bin.capacity !== null && bin.capacity !== undefined) increment.usedCapacity = delta;
  const result = await Bin.updateOne(filter, { $inc: increment }, { session });
  if (result.matchedCount !== 1) {
    throw fail(409, direction === "in" ? "Insufficient available bin capacity" : "Bin capacity balance is inconsistent");
  }

  if (direction === "in" && bin.binType === "Dedicated") {
    const otherItemStock = await Inventory.exists({
      bin: bin._id,
      item: { $ne: item._id },
      quantity: { $gt: 0 },
    }).session(session);
    if (otherItemStock) throw fail(409, "Dedicated bin already contains another item");
  }
};

export const removeStock = async (itemId, binId, amount, session) => {
  const record = await Inventory.findOneAndUpdate(
    {
      item: itemId,
      bin: binId,
      quantity: { $gte: amount },
      $expr: { $gte: [{ $subtract: ["$quantity", "$reservedQuantity"] }, amount] },
    },
    { $inc: { quantity: -amount } },
    { returnDocument: "after", session },
  );
  if (!record) throw fail(409, "Insufficient available stock");
};

const addStock = async (itemId, binId, amount, session) => {
  await Inventory.findOneAndUpdate(
    { item: itemId, bin: binId },
    { $inc: { quantity: amount }, $setOnInsert: { reservedQuantity: 0 } },
    { returnDocument: "after", upsert: true, setDefaultsOnInsert: false, runValidators: true, session },
  );
};

const movementMatches = (movement, input) =>
  movement.movementType === input.movementType &&
  String(movement.item) === input.item &&
  String(movement.sourceBin || "") === String(input.sourceBin || "") &&
  String(movement.destinationBin || "") === String(input.destinationBin || "") &&
  movement.quantity === input.quantity &&
  String(movement.adjustmentDirection || "") === String(input.adjustmentDirection || "");

export const isTransactionUnavailable = (error) =>
  error.code === 20 ||
  error.codeName === "IllegalOperation" ||
  /transaction numbers are only allowed|does not support transactions|replica set/i.test(error.message || "");

const performMovement = async (req, res, movementType) => {
  let session;
  let input;
  let alreadyProcessed = false;
  try {
    session = await mongoose.startSession();
    const transactionReference = typeof req.body.transactionReference === "string" ? req.body.transactionReference.trim() : "";
    const itemId = req.body.item;
    const quantity = Number(req.body.quantity);
    const adjustmentDirection = movementType === "adjustment" ? req.body.adjustmentDirection : null;
    if (!transactionReference) throw fail(400, "transactionReference is required");
    if (transactionReference.length > 100) throw fail(400, "transactionReference cannot exceed 100 characters");
    if (!mongoose.isValidObjectId(itemId)) throw fail(400, "Valid item ID is required");
    if (!Number.isFinite(quantity) || quantity <= 0) throw fail(400, "Quantity must be a positive number");
    if (movementType === "adjustment" && !["increase", "decrease"].includes(adjustmentDirection)) {
      throw fail(400, "adjustmentDirection must be increase or decrease");
    }

    const sourceBin = movementType === "issue" || movementType === "transfer" ||
      (movementType === "adjustment" && adjustmentDirection === "decrease") ? req.body.sourceBin : null;
    const destinationBin = ["receipt", "return"].includes(movementType) ||
      (movementType === "adjustment" && adjustmentDirection === "increase") ? req.body.destinationBin : null;
    const finalSource = movementType === "transfer" ? req.body.sourceBin : sourceBin;
    const finalDestination = movementType === "transfer" ? req.body.destinationBin : destinationBin;

    if (["issue", "transfer"].includes(movementType) && !mongoose.isValidObjectId(finalSource)) {
      throw fail(400, "Valid sourceBin is required");
    }
    if (movementType === "transfer" && !mongoose.isValidObjectId(finalDestination)) {
      throw fail(400, "Valid destinationBin is required");
    }
    if (["receipt", "return"].includes(movementType) && !mongoose.isValidObjectId(finalDestination)) {
      throw fail(400, "Valid destinationBin is required");
    }
    if (movementType === "adjustment" && adjustmentDirection === "increase" && !mongoose.isValidObjectId(finalDestination)) {
      throw fail(400, "Valid destinationBin is required for an increase");
    }
    if (movementType === "adjustment" && adjustmentDirection === "decrease" && !mongoose.isValidObjectId(finalSource)) {
      throw fail(400, "Valid sourceBin is required for a decrease");
    }
    if (movementType === "transfer" && String(finalSource) === String(finalDestination)) {
      throw fail(400, "Source and destination bins must be different");
    }

    input = {
      transactionReference,
      movementType,
      item: String(itemId),
      sourceBin: finalSource ? String(finalSource) : null,
      destinationBin: finalDestination ? String(finalDestination) : null,
      quantity,
      adjustmentDirection,
    };
    const prior = await StockMovement.findOne({ transactionReference });
    if (prior) {
      if (!movementMatches(prior, input)) throw fail(409, "transactionReference was already used for a different movement");
      return res.status(200).json({ message: "Movement was already processed", idempotent: true, movement: prior });
    }

    let movement;
    await session.withTransaction(async () => {
      const inTransaction = await StockMovement.findOne({ transactionReference }).session(session);
      if (inTransaction) {
        if (!movementMatches(inTransaction, input)) throw fail(409, "transactionReference was already used for a different movement");
        movement = inTransaction;
        alreadyProcessed = true;
        return;
      }

      const item = await Item.findById(itemId).session(session);
      if (!item?.isActive) throw fail(404, "Active item not found");

      const binIds = [...new Set([finalSource, finalDestination].filter(Boolean).map(String))].sort();
      const bins = new Map();
      for (const id of binIds) bins.set(id, await validateBinHierarchy(id, session));

      const source = finalSource ? bins.get(String(finalSource)) : null;
      const destination = finalDestination ? bins.get(String(finalDestination)) : null;
      const outgoing = movementType === "issue" || movementType === "transfer" ||
        (movementType === "adjustment" && adjustmentDirection === "decrease");
      const incoming = movementType === "receipt" || movementType === "return" ||
        (movementType === "adjustment" && adjustmentDirection === "increase");

      if (movementType === "transfer") {
        const operations = [
          { bin: source, direction: "out" },
          { bin: destination, direction: "in" },
        ].sort((a, b) => String(a.bin._id).localeCompare(String(b.bin._id)));
        for (const operation of operations) await touchBin(operation.bin, quantity, operation.direction, item, session);
      } else {
        if (outgoing && source) await touchBin(source, quantity, "out", item, session);
        if (incoming && destination) await touchBin(destination, quantity, "in", item, session);
      }

      if (movementType === "transfer") {
        await removeStock(item._id, source._id, quantity, session);
        await addStock(item._id, destination._id, quantity, session);
      } else {
        if (outgoing && source) await removeStock(item._id, source._id, quantity, session);
        if (incoming && destination) await addStock(item._id, destination._id, quantity, session);
      }

      const occurredAt = req.body.occurredAt ? new Date(req.body.occurredAt) : new Date();
      if (Number.isNaN(occurredAt.getTime())) throw fail(400, "Invalid occurredAt date");
      [movement] = await StockMovement.create([{
        transactionReference,
        movementType,
        item: item._id,
        sourceBin: source?._id || null,
        destinationBin: destination?._id || null,
        quantity,
        adjustmentDirection,
        remarks: typeof req.body.remarks === "string" ? req.body.remarks.trim().slice(0, 1000) : "",
        user: req.user.userId,
        occurredAt,
      }], { session });

      await Activity.create([{
        user: req.user.userId,
        action: `stock.${movementType}`,
        entityType: "StockMovement",
        entityId: movement._id,
        details: { transactionReference, item: String(item._id), quantity },
        ipAddress: req.ip,
      }], { session });
    });

    const idempotent = alreadyProcessed;
    return res.status(idempotent ? 200 : 201).json({
      message: idempotent ? "Movement was already processed" : "Stock movement completed",
      idempotent: Boolean(idempotent),
      movement,
    });
  } catch (error) {
    if (input?.transactionReference) {
      const prior = await StockMovement.findOne({ transactionReference: input.transactionReference });
      if (prior) {
        if (!movementMatches(prior, input)) return res.status(409).json({ message: "transactionReference was already used for a different movement" });
        return res.status(200).json({ message: "Movement was already processed", idempotent: true, movement: prior });
      }
    }
    if (error.status) return res.status(error.status).json({ message: error.message });
    if (isTransactionUnavailable(error)) {
      return res.status(503).json({ message: "Stock movements require MongoDB replica set or transaction-capable configuration" });
    }
    if (error.code === 11000) return res.status(409).json({ message: "Movement reference or inventory record already exists" });
    if (error.name === "ValidationError" || error.name === "CastError") return res.status(400).json({ message: error.message });
    return res.status(500).json({ message: "Stock movement could not be completed" });
  } finally {
    if (session) await session.endSession();
  }
};

export const receiveStock = (req, res) => performMovement(req, res, "receipt");
export const issueStock = (req, res) => performMovement(req, res, "issue");
export const transferStock = (req, res) => performMovement(req, res, "transfer");
export const adjustStock = (req, res) => performMovement(req, res, "adjustment");
export const returnStock = (req, res) => performMovement(req, res, "return");

export const getStockMovements = async (req, res) => {
  try {
    const filter = {};
    for (const field of ["item", "sourceBin", "destinationBin", "user"]) {
      if (req.query[field] !== undefined) {
        if (!mongoose.isValidObjectId(req.query[field])) return res.status(400).json({ message: `Invalid ${field} ID` });
        filter[field] = req.query[field];
      }
    }
    if (req.query.movementType) {
      if (!["receipt", "issue", "transfer", "adjustment", "return"].includes(req.query.movementType)) {
        return res.status(400).json({ message: "Invalid movementType" });
      }
      filter.movementType = req.query.movementType;
    }
    if (req.query.transactionReference) filter.transactionReference = String(req.query.transactionReference).slice(0, 100);
    if (req.query.search) {
      const search = String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const itemIds = await Item.find({
        $or: [{ itemCode: { $regex: search, $options: "i" } }, { description: { $regex: search, $options: "i" } }],
      }).distinct("_id");
      filter.$or = [
        { transactionReference: { $regex: search, $options: "i" } },
        { remarks: { $regex: search, $options: "i" } },
        { item: { $in: itemIds } },
      ];
    }
    if (req.query.warehouse !== undefined) {
      if (!mongoose.isValidObjectId(req.query.warehouse)) return res.status(400).json({ message: "Invalid warehouse ID" });
      const binIds = await getBinIdsUnder("warehouse", req.query.warehouse);
      filter.$and = [{ $or: [{ sourceBin: { $in: binIds } }, { destinationBin: { $in: binIds } }] }];
    }
    if (req.query.startDate || req.query.endDate) {
      filter.occurredAt = {};
      if (req.query.startDate) {
        const startDate = new Date(req.query.startDate);
        if (Number.isNaN(startDate.getTime())) return res.status(400).json({ message: "Invalid startDate" });
        filter.occurredAt.$gte = startDate;
      }
      if (req.query.endDate) {
        const endDate = new Date(req.query.endDate);
        if (Number.isNaN(endDate.getTime())) return res.status(400).json({ message: "Invalid endDate" });
        filter.occurredAt.$lte = endDate;
      }
      if (filter.occurredAt.$gte && filter.occurredAt.$lte && filter.occurredAt.$gte > filter.occurredAt.$lte) {
        return res.status(400).json({ message: "startDate must be before endDate" });
      }
    }
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const [movements, total] = await Promise.all([
      StockMovement.find(filter).populate("item", "itemCode description uom").populate("sourceBin", "binCode binName locationCode").populate("destinationBin", "binCode binName locationCode").populate("user", "fullName email").sort({ occurredAt: -1 }).skip((page - 1) * limit).limit(limit),
      StockMovement.countDocuments(filter),
    ]);
    res.status(200).json({ movements, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
