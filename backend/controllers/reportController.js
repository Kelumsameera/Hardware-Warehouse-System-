import mongoose from "mongoose";
import ExcelJS from "exceljs";
import Bin from "../models/Bin.js";
import Inventory from "../models/Inventory.js";
import Item from "../models/Item.js";
import Level from "../models/Level.js";
import Rack from "../models/Rack.js";
import StockMovement from "../models/StockMovement.js";
import Warehouse from "../models/Warehouse.js";
import Zone from "../models/Zone.js";

const MAX_EXPORT_ROWS = 50000;
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getPage = (req) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(MAX_EXPORT_ROWS, Math.max(1, Number.parseInt(req.query.limit, 10) || 10000));
  return { page, limit, skip: (page - 1) * limit };
};

const searchRegex = (req) => req.query.search ? new RegExp(escapeRegex(String(req.query.search)), "i") : null;

const getWarehouseBinFilter = async (warehouseId) => {
  if (!mongoose.isValidObjectId(warehouseId)) throw Object.assign(new Error("Invalid warehouse ID"), { status: 400 });
  if (!(await Warehouse.exists({ _id: warehouseId }))) throw Object.assign(new Error("Warehouse not found"), { status: 404 });
  const zones = await Zone.find({ warehouse: warehouseId }).distinct("_id");
  const racks = await Rack.find({ zone: { $in: zones } }).distinct("_id");
  const levels = await Level.find({ rack: { $in: racks } }).distinct("_id");
  return { bin: { $in: await Bin.find({ level: { $in: levels } }).distinct("_id") } };
};

const getStockRecords = async (req) => {
  const filter = {};
  const search = searchRegex(req);
  if (search) {
    const itemIds = await Item.find({ $or: [{ itemCode: search }, { description: search }] }).distinct("_id");
    const binIds = await Bin.find({ $or: [{ binCode: search }, { binName: search }, { locationCode: search }] }).distinct("_id");
    filter.$or = [{ item: { $in: itemIds } }, { bin: { $in: binIds } }];
  }
  if (req.query.warehouse) Object.assign(filter, await getWarehouseBinFilter(req.query.warehouse));

  const { page, limit, skip } = getPage(req);
  const records = await Inventory.find(filter)
    .populate("item", "itemCode description uom minStock maxStock reorderLevel")
    .populate({ path: "bin", populate: { path: "level", populate: { path: "rack", populate: { path: "zone", populate: { path: "warehouse", select: "warehouseCode warehouseName" } } } } })
    .sort({ item: 1, bin: 1 })
    .skip(skip)
    .limit(limit);
  return records;
};

const stockRow = (record) => {
  const warehouse = record.bin?.level?.rack?.zone?.warehouse;
  return {
    itemCode: record.item?.itemCode || "",
    description: record.item?.description || "",
    uom: record.item?.uom || "",
    warehouseCode: warehouse?.warehouseCode || "",
    warehouseName: warehouse?.warehouseName || "",
    zone: record.bin?.level?.rack?.zone?.zoneCode || "",
    rack: record.bin?.level?.rack?.rackCode || "",
    level: record.bin?.level?.levelCode || "",
    binCode: record.bin?.binCode || "",
    locationCode: record.bin?.locationCode || "",
    quantity: record.quantity,
    reservedQuantity: record.reservedQuantity,
    availableQuantity: record.quantity - record.reservedQuantity,
  };
};

const sendExcel = async (res, filename, worksheetName, columns, rows) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(worksheetName);
  worksheet.columns = columns;
  worksheet.addRows(rows);
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.status(200).send(Buffer.from(buffer));
};

const runReport = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    if (error.name === "ValidationError" || error.name === "CastError") return res.status(400).json({ message: error.message });
    res.status(500).json({ message: error.message });
  }
};

export const exportItems = runReport(async (req, res) => {
  const search = searchRegex(req);
  const filter = search ? { $or: [{ itemCode: search }, { description: search }, { itemGroup: search }] } : {};
  const { skip, limit } = getPage(req);
  const items = await Item.find(filter).sort({ itemCode: 1 }).skip(skip).limit(limit);
  const rows = items.map((item) => ({
    itemCode: item.itemCode,
    description: item.description,
    itemGroup: item.itemGroup || "",
    itemType: item.itemType || "",
    uom: item.uom || "",
    minStock: item.minStock,
    reorderLevel: item.reorderLevel,
    maxStock: item.maxStock ?? "",
    isActive: item.isActive,
  }));
  await sendExcel(res, "item-master.xlsx", "Items", [
    { header: "Item Code", key: "itemCode", width: 20 },
    { header: "Description", key: "description", width: 40 },
    { header: "Item Group", key: "itemGroup", width: 24 },
    { header: "Item Type", key: "itemType", width: 20 },
    { header: "UoM", key: "uom", width: 14 },
    { header: "Minimum Stock", key: "minStock", width: 16 },
    { header: "Reorder Level", key: "reorderLevel", width: 16 },
    { header: "Maximum Stock", key: "maxStock", width: 16 },
    { header: "Active", key: "isActive", width: 12 },
  ], rows);
});

export const exportWarehouseStock = runReport(async (req, res) => {
  if (!req.query.warehouse) throw Object.assign(new Error("warehouse query parameter is required"), { status: 400 });
  const records = await getStockRecords(req);
  await sendExcel(res, "warehouse-stock.xlsx", "Warehouse Stock", [
    { header: "Item Code", key: "itemCode", width: 20 },
    { header: "Description", key: "description", width: 40 },
    { header: "UoM", key: "uom", width: 14 },
    { header: "Warehouse Code", key: "warehouseCode", width: 18 },
    { header: "Warehouse", key: "warehouseName", width: 30 },
    { header: "Zone", key: "zone", width: 14 },
    { header: "Rack", key: "rack", width: 14 },
    { header: "Level", key: "level", width: 14 },
    { header: "Bin", key: "binCode", width: 14 },
    { header: "Location Code", key: "locationCode", width: 22 },
    { header: "Quantity", key: "quantity", width: 14 },
    { header: "Reserved", key: "reservedQuantity", width: 14 },
    { header: "Available", key: "availableQuantity", width: 14 },
  ], records.map(stockRow));
});

export const exportBinStock = runReport(async (req, res) => {
  const records = await getStockRecords(req);
  await sendExcel(res, "bin-stock.xlsx", "Bin Stock", [
    { header: "Item Code", key: "itemCode", width: 20 },
    { header: "Description", key: "description", width: 40 },
    { header: "UoM", key: "uom", width: 14 },
    { header: "Warehouse", key: "warehouseName", width: 30 },
    { header: "Zone", key: "zone", width: 14 },
    { header: "Rack", key: "rack", width: 14 },
    { header: "Level", key: "level", width: 14 },
    { header: "Bin", key: "binCode", width: 14 },
    { header: "Location Code", key: "locationCode", width: 22 },
    { header: "Quantity", key: "quantity", width: 14 },
    { header: "Reserved", key: "reservedQuantity", width: 14 },
    { header: "Available", key: "availableQuantity", width: 14 },
  ], records.map(stockRow));
});

export const exportMovements = runReport(async (req, res) => {
  const filter = {};
  for (const field of ["startDate", "endDate"]) {
    if (req.query[field]) {
      const date = new Date(req.query[field]);
      if (Number.isNaN(date.getTime())) throw Object.assign(new Error(`Invalid ${field}`), { status: 400 });
      if (field === "startDate") filter.occurredAt = { ...filter.occurredAt, $gte: date };
      else filter.occurredAt = { ...filter.occurredAt, $lte: date };
    }
  }
  if (filter.occurredAt?.$gte && filter.occurredAt?.$lte && filter.occurredAt.$gte > filter.occurredAt.$lte) {
    throw Object.assign(new Error("startDate must be before endDate"), { status: 400 });
  }
  if (req.query.movementType) {
    if (!["receipt", "issue", "transfer", "adjustment", "return"].includes(req.query.movementType)) {
      throw Object.assign(new Error("Invalid movementType"), { status: 400 });
    }
    filter.movementType = req.query.movementType;
  }
  if (req.query.item) {
    if (!mongoose.isValidObjectId(req.query.item)) throw Object.assign(new Error("Invalid item ID"), { status: 400 });
    filter.item = req.query.item;
  }
  if (req.query.warehouse) {
    const { bin } = await getWarehouseBinFilter(req.query.warehouse);
    filter.$and = [{ $or: [{ sourceBin: bin }, { destinationBin: bin }] }];
  }
  if (req.query.search) {
    const search = searchRegex(req);
    const itemIds = await Item.find({ $or: [{ itemCode: search }, { description: search }] }).distinct("_id");
    filter.$or = [{ transactionReference: search }, { remarks: search }, { item: { $in: itemIds } }];
  }
  const { skip, limit } = getPage(req);
  const movements = await StockMovement.find(filter)
    .populate("item", "itemCode description uom")
    .populate("sourceBin", "binCode locationCode")
    .populate("destinationBin", "binCode locationCode")
    .populate("user", "fullName")
    .sort({ occurredAt: -1 })
    .skip(skip)
    .limit(limit);
  await sendExcel(res, "stock-movements.xlsx", "Movements", [
    { header: "Reference", key: "reference", width: 24 },
    { header: "Type", key: "type", width: 16 },
    { header: "Item Code", key: "itemCode", width: 20 },
    { header: "Item Description", key: "description", width: 36 },
    { header: "Quantity", key: "quantity", width: 14 },
    { header: "Source Bin", key: "source", width: 18 },
    { header: "Destination Bin", key: "destination", width: 18 },
    { header: "User", key: "user", width: 24 },
    { header: "Date", key: "date", width: 24 },
    { header: "Remarks", key: "remarks", width: 40 },
  ], movements.map((movement) => ({
    reference: movement.transactionReference,
    type: movement.movementType,
    itemCode: movement.item?.itemCode || "",
    description: movement.item?.description || "",
    quantity: movement.quantity,
    source: movement.sourceBin?.locationCode || movement.sourceBin?.binCode || "",
    destination: movement.destinationBin?.locationCode || movement.destinationBin?.binCode || "",
    user: movement.user?.fullName || "",
    date: movement.occurredAt,
    remarks: movement.remarks,
  })));
});

const getAlertRows = async (req) => {
  const filter = {};
  if (req.query.warehouse) Object.assign(filter, await getWarehouseBinFilter(req.query.warehouse));
  const [items, stock] = await Promise.all([
    Item.find({ isActive: true }).select("itemCode description uom minStock maxStock reorderLevel").sort({ itemCode: 1 }),
    Inventory.aggregate([
      { $match: filter },
      { $group: { _id: "$item", quantity: { $sum: "$quantity" }, reservedQuantity: { $sum: "$reservedQuantity" } } },
    ]),
  ]);
  const stockByItem = new Map(stock.map((row) => [String(row._id), row]));
  const search = searchRegex(req);
  return items.filter((item) => !search || search.test(item.itemCode) || search.test(item.description)).map((item) => {
    const stockRowForItem = stockByItem.get(String(item._id));
    const quantity = stockRowForItem?.quantity || 0;
    const reorderLevel = item.reorderLevel || 0;
    const minStock = item.minStock || 0;
    return {
      itemCode: item.itemCode,
      description: item.description,
      uom: item.uom,
      quantity,
      reservedQuantity: stockRowForItem?.reservedQuantity || 0,
      availableQuantity: quantity - (stockRowForItem?.reservedQuantity || 0),
      minStock,
      reorderLevel,
      maxStock: item.maxStock,
    };
  });
};

const exportAlerts = (type) => runReport(async (req, res) => {
  const records = await getAlertRows(req);
  let filtered = records;
  if (type === "low-stock") filtered = records.filter((row) => Math.max(row.minStock, row.reorderLevel) > 0 && row.quantity <= Math.max(row.minStock, row.reorderLevel));
  if (type === "reorder") filtered = records.filter((row) => row.reorderLevel > 0 && row.quantity <= row.reorderLevel);
  if (type === "summary") filtered = records;
  const { skip, limit } = getPage(req);
  filtered = filtered.slice(skip, skip + limit);
  await sendExcel(res, `${type}-stock.xlsx`, "Stock Alerts", [
    { header: "Item Code", key: "itemCode", width: 20 },
    { header: "Description", key: "description", width: 40 },
    { header: "UoM", key: "uom", width: 14 },
    { header: "Quantity", key: "quantity", width: 14 },
    { header: "Reserved", key: "reservedQuantity", width: 14 },
    { header: "Available", key: "availableQuantity", width: 14 },
    { header: "Minimum Stock", key: "minStock", width: 16 },
    { header: "Reorder Level", key: "reorderLevel", width: 16 },
    { header: "Maximum Stock", key: "maxStock", width: 16 },
  ], filtered);
});

export const exportLowStock = exportAlerts("low-stock");
export const exportReorder = exportAlerts("reorder");
export const exportStockSummary = runReport(async (req, res) => {
  const match = {};
  if (req.query.warehouse) Object.assign(match, await getWarehouseBinFilter(req.query.warehouse));
  const search = searchRegex(req);
  if (search) {
    match.item = {
      $in: await Item.find({ $or: [{ itemCode: search }, { description: search }] }).distinct("_id"),
    };
  }
  const { skip, limit } = getPage(req);
  const summary = await Inventory.aggregate([
    { $match: match },
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
        binCount: { $sum: 1 },
      },
    },
    { $sort: { "_id.warehouse": 1, "_id.item": 1 } },
    { $skip: skip },
    { $limit: limit },
    { $lookup: { from: "items", localField: "_id.item", foreignField: "_id", as: "item" } },
    { $unwind: "$item" },
    { $lookup: { from: "warehouses", localField: "_id.warehouse", foreignField: "_id", as: "warehouse" } },
    { $unwind: "$warehouse" },
  ]);
  await sendExcel(res, "stock-summary.xlsx", "Stock Summary", [
    { header: "Warehouse Code", key: "warehouseCode", width: 18 },
    { header: "Warehouse", key: "warehouseName", width: 30 },
    { header: "Item Code", key: "itemCode", width: 20 },
    { header: "Description", key: "description", width: 40 },
    { header: "UoM", key: "uom", width: 14 },
    { header: "Bins", key: "binCount", width: 12 },
    { header: "Quantity", key: "quantity", width: 14 },
    { header: "Reserved", key: "reservedQuantity", width: 14 },
    { header: "Available", key: "availableQuantity", width: 14 },
  ], summary.map((row) => ({
    warehouseCode: row.warehouse.warehouseCode,
    warehouseName: row.warehouse.warehouseName,
    itemCode: row.item.itemCode,
    description: row.item.description,
    uom: row.item.uom,
    binCount: row.binCount,
    quantity: row.quantity,
    reservedQuantity: row.reservedQuantity,
    availableQuantity: row.quantity - row.reservedQuantity,
  })));
});
