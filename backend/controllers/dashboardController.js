import Bin from "../models/Bin.js";
import Inventory from "../models/Inventory.js";
import Item from "../models/Item.js";
import Level from "../models/Level.js";
import Rack from "../models/Rack.js";
import StockMovement from "../models/StockMovement.js";
import Warehouse from "../models/Warehouse.js";
import Zone from "../models/Zone.js";
import { buildStockRecords } from "./alertController.js";

const MOVEMENT_ROLES = ["Super Admin", "Admin", "Supervisor", "Store Keeper"];
const MOVEMENT_TYPES = ["receipt", "issue", "transfer", "adjustment", "return"];

// Bin counts per warehouse. Capacity units differ between bins, so capacity is reported
// as bin counts (full / occupied / available) instead of summing mixed units.
const getWarehouseCapacity = async () => {
  const occupiedBins = await Inventory.find({ quantity: { $gt: 0 } }).distinct("bin");
  return Bin.aggregate([
    { $lookup: { from: "levels", localField: "level", foreignField: "_id", as: "level" } },
    { $unwind: "$level" },
    { $lookup: { from: "racks", localField: "level.rack", foreignField: "_id", as: "rack" } },
    { $unwind: "$rack" },
    { $lookup: { from: "zones", localField: "rack.zone", foreignField: "_id", as: "zone" } },
    { $unwind: "$zone" },
    { $lookup: { from: "warehouses", localField: "zone.warehouse", foreignField: "_id", as: "warehouse" } },
    { $unwind: "$warehouse" },
    {
      $group: {
        _id: "$warehouse._id",
        warehouseCode: { $first: "$warehouse.warehouseCode" },
        warehouseName: { $first: "$warehouse.warehouseName" },
        totalBins: { $sum: 1 },
        activeBins: { $sum: { $cond: ["$isActive", 1, 0] } },
        fullBins: {
          $sum: { $cond: [{ $and: ["$isActive", { $ne: ["$capacity", null] }, { $gte: [{ $ifNull: ["$usedCapacity", 0] }, "$capacity"] }] }, 1, 0] },
        },
        occupiedBins: { $sum: { $cond: [{ $in: ["$_id", occupiedBins] }, 1, 0] } },
      },
    },
    { $sort: { warehouseCode: 1 } },
    {
      $project: {
        _id: 0,
        warehouse: "$_id",
        warehouseCode: 1,
        warehouseName: 1,
        totalBins: 1,
        activeBins: 1,
        fullBins: 1,
        occupiedBins: 1,
        emptyActiveBins: { $max: [0, { $subtract: ["$activeBins", "$occupiedBins"] }] },
      },
    },
  ]);
};

const getMovementSeries = async (days) => {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (days - 1));
  const rows = await StockMovement.aggregate([
    { $match: { occurredAt: { $gte: since } } },
    { $group: { _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$occurredAt" } }, type: "$movementType" }, count: { $sum: 1 } } },
  ]);
  const series = [];
  for (let index = 0; index < days; index += 1) {
    const date = new Date(since);
    date.setUTCDate(since.getUTCDate() + index);
    const day = date.toISOString().slice(0, 10);
    const entry = { date: day };
    for (const type of MOVEMENT_TYPES) {
      entry[type] = rows.find((row) => row._id.day === day && row._id.type === type)?.count || 0;
    }
    series.push(entry);
  }
  return series;
};

export const getDashboard = async (req, res) => {
  try {
    const canSeeMovements = req.user.permissions?.movements === true;
    const [
      totalItems, activeItems, totalWarehouses, activeWarehouses, totalZones, totalRacks, totalLevels, totalBins, activeBins,
      stockTotals, stockRecords, capacity, movementSeries, recentMovements,
    ] = await Promise.all([
      Item.countDocuments(),
      Item.countDocuments({ isActive: true }),
      Warehouse.countDocuments(),
      Warehouse.countDocuments({ isActive: true }),
      Zone.countDocuments(),
      Rack.countDocuments(),
      Level.countDocuments(),
      Bin.countDocuments(),
      Bin.countDocuments({ isActive: true }),
      Inventory.aggregate([{ $group: { _id: null, quantity: { $sum: "$quantity" }, reservedQuantity: { $sum: "$reservedQuantity" }, records: { $sum: { $cond: [{ $gt: ["$quantity", 0] }, 1, 0] } } } }]),
      buildStockRecords(),
      getWarehouseCapacity(),
      canSeeMovements ? getMovementSeries(14) : Promise.resolve(null),
      canSeeMovements
        ? StockMovement.find().populate("item", "itemCode description uom").populate("sourceBin", "binCode locationCode").populate("destinationBin", "binCode locationCode").populate("user", "fullName").sort({ occurredAt: -1 }).limit(8)
        : Promise.resolve(null),
    ]);

    const records = stockRecords.records;
    const totals = stockTotals[0] || { quantity: 0, reservedQuantity: 0, records: 0 };
    const lowStock = records.filter((record) => record.lowStock && !record.outOfStock);
    const outOfStock = records.filter((record) => record.outOfStock);
    const attention = records
      .filter((record) => record.outOfStock || record.lowStock)
      .sort((a, b) => Number(b.outOfStock) - Number(a.outOfStock) || a.quantity - b.quantity)
      .slice(0, 8);

    res.status(200).json({
      counts: {
        totalItems,
        activeItems,
        totalWarehouses,
        activeWarehouses,
        totalZones,
        totalRacks,
        totalLevels,
        totalBins,
        activeBins,
      },
      stock: {
        quantity: totals.quantity,
        reservedQuantity: totals.reservedQuantity,
        availableQuantity: totals.quantity - totals.reservedQuantity,
        stockedLocations: totals.records,
        lowStockItems: lowStock.length,
        outOfStockItems: outOfStock.length,
      },
      alerts: attention,
      capacity,
      movementSeries,
      recentMovements,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
