import mongoose from "mongoose";
import Item from "../models/Item.js";
import Inventory from "../models/Inventory.js";
import ExcelJS from "exceljs";
import { recordActivity } from "./activityController.js";

const ITEM_FIELDS = ["itemCode", "description", "itemGroup", "itemType", "uom", "bomType", "minStock", "maxStock", "reorderLevel", "isActive"];
const SORT_FIELDS = ["itemCode", "description", "itemGroup", "itemType", "uom", "createdAt", "updatedAt"];

const pickFields = (body = {}, fields) => {
  const values = {};
  for (const field of fields) {
    if (body[field] !== undefined) values[field] = body[field];
  }
  return values;
};

// Checks min/reorder/max consistency using the values that will be stored.
const validateStockLevels = ({ minStock, reorderLevel, maxStock }) => {
  for (const [label, value] of [["Minimum stock", minStock], ["Reorder level", reorderLevel], ["Maximum stock", maxStock]]) {
    if (value === null || value === undefined || value === "") continue;
    if (!Number.isFinite(Number(value)) || Number(value) < 0) return `${label} must be a number of zero or more`;
  }
  const hasMax = maxStock !== null && maxStock !== undefined && maxStock !== "";
  if (hasMax && Number(minStock || 0) > Number(maxStock)) return "Minimum stock cannot exceed maximum stock";
  if (hasMax && Number(reorderLevel || 0) > Number(maxStock)) return "Reorder level cannot exceed maximum stock";
  return null;
};

export const createItem = async (req, res) => {
  try {
    const values = pickFields(req.body, ITEM_FIELDS);
    if (typeof values.itemCode !== "string" || !values.itemCode.trim()) return res.status(400).json({ message: "Item code is required" });
    if (typeof values.description !== "string" || !values.description.trim()) return res.status(400).json({ message: "Description is required" });
    if (values.isActive !== undefined && typeof values.isActive !== "boolean") return res.status(400).json({ message: "isActive must be a boolean" });
    if (values.maxStock === "") values.maxStock = null;
    const invalid = validateStockLevels(values);
    if (invalid) return res.status(400).json({ message: invalid });

    const item = await Item.create(values);
    await recordActivity(req, "item.create", "Item", item._id, { itemCode: item.itemCode });

    res.status(201).json({
      message: "Item created successfully",
      item,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "Item code already exists",
      });
    }

    res.status(400).json({
      message: error.message,
    });
  }
};

export const getItems = async (req, res) => {
  try {
    const search = req.query.search || "";
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));

    const filter = {};

    if (search) {
      const safeSearch = String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      filter.$or = [{ itemCode: { $regex: safeSearch, $options: "i" } }, { description: { $regex: safeSearch, $options: "i" } }, { itemGroup: { $regex: safeSearch, $options: "i" } }];
    }
    if (req.query.isActive === "true" || req.query.isActive === "false") filter.isActive = req.query.isActive === "true";
    for (const field of ["itemGroup", "itemType", "uom"]) {
      if (typeof req.query[field] === "string" && req.query[field]) filter[field] = req.query[field].slice(0, 120);
    }

    const sortField = SORT_FIELDS.includes(req.query.sort) ? req.query.sort : "createdAt";
    const sortOrder = req.query.order === "asc" ? 1 : -1;

    const total = await Item.countDocuments(filter);

    const items = await Item.find(filter)
      .sort({ [sortField]: sortOrder, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.status(200).json({
      items,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

export const getItemFilters = async (req, res) => {
  try {
    const [itemGroups, itemTypes, uoms] = await Promise.all([
      Item.distinct("itemGroup"),
      Item.distinct("itemType"),
      Item.distinct("uom"),
    ]);
    const clean = (values) => values.filter((value) => typeof value === "string" && value.trim()).sort((a, b) => a.localeCompare(b));
    res.status(200).json({ itemGroups: clean(itemGroups), itemTypes: clean(itemTypes), uoms: clean(uoms) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getItem = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid item ID",
      });
    }

    const item = await Item.findById(req.params.id);

    if (!item) {
      return res.status(404).json({
        message: "Item not found",
      });
    }

    res.status(200).json(item);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

export const updateItem = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid item ID",
      });
    }

    const changes = {};
    for (const field of ["description", "itemGroup", "itemType", "uom", "bomType", "minStock", "maxStock", "reorderLevel", "image", "images", "isActive"]) {
      if (req.body[field] !== undefined) changes[field] = req.body[field];
    }
    if (changes.isActive !== undefined && typeof changes.isActive !== "boolean") {
      return res.status(400).json({ message: "isActive must be a boolean" });
    }
    if (changes.description !== undefined && (typeof changes.description !== "string" || !changes.description.trim())) {
      return res.status(400).json({ message: "Description is required" });
    }
    if (changes.maxStock === "") changes.maxStock = null;
    const current = await Item.findById(req.params.id).select("itemCode minStock reorderLevel maxStock images");
    if (!current) return res.status(404).json({ message: "Item not found" });
    if (req.body.itemCode !== undefined && String(req.body.itemCode).trim() !== current.itemCode) {
      return res.status(400).json({ message: "Item codes cannot be changed" });
    }
    const invalid = validateStockLevels({
      minStock: changes.minStock !== undefined ? changes.minStock : current.minStock,
      reorderLevel: changes.reorderLevel !== undefined ? changes.reorderLevel : current.reorderLevel,
      maxStock: changes.maxStock !== undefined ? changes.maxStock : current.maxStock,
    });
    if (invalid) return res.status(400).json({ message: invalid });
    if (changes.images !== undefined) return res.status(400).json({ message: "Use the item image endpoints to add or remove images" });
    if (changes.image !== undefined && changes.image !== null && !current.images.includes(changes.image)) {
      return res.status(400).json({ message: "Primary image must be one of the uploaded item images" });
    }
    const item = await Item.findByIdAndUpdate(req.params.id, changes, {
      returnDocument: "after",
      runValidators: true,
    });

    if (!item) {
      return res.status(404).json({
        message: "Item not found",
      });
    }

    await recordActivity(req, "item.update", "Item", item._id, { fields: Object.keys(changes) });
    res.status(200).json({
      message: "Item updated successfully",
      item,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "Item code already exists",
      });
    }

    res.status(400).json({
      message: error.message,
    });
  }
};

export const deleteItem = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid item ID",
      });
    }

    const item = await Item.findByIdAndUpdate(req.params.id, { isActive: false }, { returnDocument: "after", runValidators: true });

    if (!item) {
      return res.status(404).json({
        message: "Item not found",
      });
    }

    await recordActivity(req, "item.deactivate", "Item", item._id, { itemCode: item.itemCode });
    res.status(200).json({ message: "Item deactivated successfully", item });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

export const importItems = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Excel file is required" });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);

    const sheet = workbook.getWorksheet("Sheet2") || workbook.worksheets[0];

    if (!sheet) {
      return res.status(400).json({ message: "No worksheet found" });
    }
    if (sheet.rowCount > 50000 || sheet.columnCount > 100) {
      return res.status(413).json({ message: "Excel import cannot exceed 50,000 rows or 100 columns" });
    }

    const headers = [];
    sheet.getRow(1).eachCell((cell, col) => {
      headers[col] = String(cell.text).trim();
    });

    let imported = 0;
    let updated = 0;
    let skipped = 0;

    for (let i = 2; i <= sheet.rowCount; i++) {
      const row = sheet.getRow(i);
      const data = {};

      row.eachCell({ includeEmpty: true }, (cell, col) => {
        if (headers[col]) {
          data[headers[col]] = cell.text.trim();
        }
      });

      const itemCode = String(data["Item No."] || "").trim();
      const description = String(data["Item Description"] || "").trim();

      if (!itemCode || !description) {
        skipped++;
        continue;
      }

      const item = {
        itemCode,
        description,
        uom: data["UoM Group"] || "Pieces",
        itemType: data["Item Type"] || "",
        itemGroup: data["Item Group"] || "",
        bomType: data["BOM Type"] || "",
        isActive: !["n", "no", "false", "0", "inactive"].includes(
          String(data["Active"] || "")
            .trim()
            .toLowerCase(),
        ),
      };

      const existing = await Item.findOne({ itemCode });

      if (existing) {
        await Item.updateOne({ itemCode }, { $set: item });
        updated++;
      } else {
        await Item.create(item);
        imported++;
      }
    }

    await recordActivity(req, "item.import", "Item", null, { imported, updated, skipped, fileName: req.file.originalname.slice(0, 200) });
    res.status(200).json({
      message: "Excel import completed",
      total: imported + updated + skipped,
      imported,
      updated,
      skipped,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Stock status for technicians: available = on hand - reserved, summed over all bins.
const stockStatus = (item, available) => {
  if (available <= 0) return "OUT_OF_STOCK";
  const threshold = Math.max(item.minStock || 0, item.reorderLevel || 0);
  return threshold > 0 && available <= threshold ? "LOW_STOCK" : "IN_STOCK";
};

const stockTotals = async (itemIds) => {
  const rows = await Inventory.aggregate([
    { $match: { item: { $in: itemIds } } },
    { $group: { _id: "$item", quantity: { $sum: "$quantity" }, reservedQuantity: { $sum: "$reservedQuantity" } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row]));
};

const availabilityRow = (item, totals) => {
  const row = totals.get(String(item._id));
  const quantity = row?.quantity || 0;
  const reservedQuantity = row?.reservedQuantity || 0;
  const availableQuantity = Math.round((quantity - reservedQuantity) * 1e6) / 1e6;
  return {
    _id: item._id,
    itemCode: item.itemCode,
    description: item.description,
    itemGroup: item.itemGroup || "",
    itemType: item.itemType || "",
    uom: item.uom || "",
    image: item.image || null,
    minStock: item.minStock,
    reorderLevel: item.reorderLevel,
    quantity,
    reservedQuantity,
    availableQuantity,
    stockStatus: stockStatus(item, availableQuantity),
  };
};

export const getItemAvailability = async (req, res) => {
  try {
    const filter = { isActive: true };
    if (typeof req.query.ids === "string" && req.query.ids) {
      const ids = req.query.ids.split(",").slice(0, 100);
      if (ids.some((id) => !mongoose.isValidObjectId(id))) return res.status(400).json({ message: "Invalid item ID" });
      filter._id = { $in: ids };
    }
    if (typeof req.query.search === "string" && req.query.search.trim()) {
      const search = req.query.search.trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = ["itemCode", "description", "itemGroup", "itemType"].map((field) => ({ [field]: { $regex: search, $options: "i" } }));
    }
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const [items, total] = await Promise.all([
      Item.find(filter).select("itemCode description itemGroup itemType uom image minStock reorderLevel").sort({ itemCode: 1 }).skip((page - 1) * limit).limit(limit),
      Item.countDocuments(filter),
    ]);
    const totals = await stockTotals(items.map((item) => item._id));
    res.status(200).json({ items: items.map((item) => availabilityRow(item, totals)), total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getItemAvailabilityDetail = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid item ID" });
    const item = await Item.findById(req.params.id).select("itemCode description itemGroup itemType uom image images minStock reorderLevel maxStock isActive");
    if (!item) return res.status(404).json({ message: "Item not found" });
    const totals = await stockTotals([item._id]);
    const byWarehouse = await Inventory.aggregate([
      { $match: { item: item._id, quantity: { $gt: 0 } } },
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
      { $group: { _id: "$warehouse._id", warehouseCode: { $first: "$warehouse.warehouseCode" }, warehouseName: { $first: "$warehouse.warehouseName" }, quantity: { $sum: "$quantity" }, reservedQuantity: { $sum: "$reservedQuantity" } } },
      { $sort: { warehouseCode: 1 } },
    ]);
    res.status(200).json({
      item: { ...availabilityRow(item, totals), images: item.images, maxStock: item.maxStock, isActive: item.isActive },
      warehouses: byWarehouse.map((row) => ({ warehouse: row._id, warehouseCode: row.warehouseCode, warehouseName: row.warehouseName, availableQuantity: row.quantity - row.reservedQuantity })),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
