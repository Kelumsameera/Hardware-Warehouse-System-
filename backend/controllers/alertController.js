import mongoose from "mongoose";
import Inventory from "../models/Inventory.js";
import Item from "../models/Item.js";
import Warehouse from "../models/Warehouse.js";

// Builds one stock-status record per active item. Shared by the alerts API and the dashboard.
export const buildStockRecords = async (warehouseId) => {
    const pipeline = [
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
    ];
    if (warehouseId) pipeline.push({ $match: { "warehouse._id": warehouseId } });
    pipeline.push({
      $group: {
        _id: "$item",
        quantity: { $sum: "$quantity" },
        reservedQuantity: { $sum: "$reservedQuantity" },
      },
    });

    const [items, stock] = await Promise.all([
      Item.find({ isActive: true }).select("itemCode description uom minStock maxStock reorderLevel").sort({ itemCode: 1 }),
      Inventory.aggregate(pipeline),
    ]);
    const stockByItem = new Map(stock.map((record) => [String(record._id), record]));
    const records = items.map((item) => {
      const current = stockByItem.get(String(item._id));
      const quantity = current?.quantity || 0;
      const reservedQuantity = current?.reservedQuantity || 0;
      const availableQuantity = quantity - reservedQuantity;
      const minimum = item.minStock || 0;
      const reorderLevel = item.reorderLevel || 0;
      return {
        item: { id: String(item._id), itemCode: item.itemCode, description: item.description, uom: item.uom },
        warehouse: warehouseId ? String(warehouseId) : null,
        quantity,
        reservedQuantity,
        availableQuantity,
        minStock: minimum,
        reorderLevel,
        maxStock: item.maxStock,
        outOfStock: quantity === 0,
        belowMinimum: minimum > 0 && quantity < minimum,
        atOrBelowReorder: reorderLevel > 0 && quantity <= reorderLevel,
        aboveMaximum: item.maxStock !== null && item.maxStock !== undefined && quantity > item.maxStock,
        lowStock: Math.max(minimum, reorderLevel) > 0 && quantity <= Math.max(minimum, reorderLevel),
      };
    });
    return { items, records };
};

export const ALERT_TYPES = {
  "out-of-stock": "outOfStock",
  minimum: "belowMinimum",
  reorder: "atOrBelowReorder",
  maximum: "aboveMaximum",
  "low-stock": "lowStock",
};

export const getStockAlerts = async (req, res) => {
  try {
    let warehouseId;
    if (req.query.warehouse !== undefined) {
      if (!mongoose.isValidObjectId(req.query.warehouse)) return res.status(400).json({ message: "Invalid warehouse ID" });
      warehouseId = new mongoose.Types.ObjectId(req.query.warehouse);
      if (!(await Warehouse.exists({ _id: warehouseId }))) return res.status(404).json({ message: "Warehouse not found" });
    }
    const { items, records } = await buildStockRecords(warehouseId);

    const alertTypes = ALERT_TYPES;
    const requestedType = req.params.type || req.query.type;
    if (requestedType && !alertTypes[requestedType]) {
      return res.status(400).json({ message: `type must be one of: ${Object.keys(alertTypes).join(", ")}` });
    }
    let alerts = requestedType
      ? records.filter((record) => record[alertTypes[requestedType]])
      : records.filter((record) => record.outOfStock || record.belowMinimum || record.atOrBelowReorder || record.aboveMaximum);
    const counts = Object.fromEntries(Object.entries(alertTypes).map(([type, flag]) => [type, records.filter((record) => record[flag]).length]));

    if (typeof req.query.search === "string" && req.query.search.trim()) {
      const search = req.query.search.trim().toLowerCase();
      alerts = alerts.filter((record) => record.item.itemCode.toLowerCase().includes(search) || record.item.description.toLowerCase().includes(search));
    }
    const alertCount = alerts.length;

    // Pagination is optional so existing callers that expect the full list keep working.
    let pagination = {};
    if (req.query.page !== undefined || req.query.limit !== undefined) {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
      alerts = alerts.slice((page - 1) * limit, page * limit);
      pagination = { page, totalPages: Math.ceil(alertCount / limit) };
    }

    res.status(200).json({
      warehouse: warehouseId ? String(warehouseId) : null,
      totalItems: items.length,
      alertCount,
      counts,
      ...pagination,
      alerts,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
