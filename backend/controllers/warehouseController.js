import mongoose from "mongoose";
import Warehouse from "../models/Warehouse.js";
import { recordActivity } from "./activityController.js";
import { locationHasStock } from "./locationHelpers.js";

export const createWarehouse = async (req, res) => {
  try {
    const { warehouseCode, warehouseName, description, location } = req.body;
    const warehouse = await Warehouse.create({ warehouseCode, warehouseName, description, location });
    await recordActivity(req, "warehouse.create", "Warehouse", warehouse._id, { warehouseCode: warehouse.warehouseCode });
    res.status(201).json({
      message: "Warehouse created successfully",
      warehouse,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "Warehouse code already exists",
      });
    }
    res.status(400).json({ message: error.message });
  }
};

export const getWarehouses = async (req, res) => {
  try {
    const warehouses = await Warehouse.find().sort({ createdAt: -1 });
    res.status(200).json(warehouses);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getWarehouse = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid warehouse ID" });
    }

    const warehouse = await Warehouse.findById(req.params.id);

    if (!warehouse) {
      return res.status(404).json({ message: "Warehouse not found" });
    }

    res.status(200).json(warehouse);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateWarehouse = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid warehouse ID" });
    }

    const changes = {};
    for (const field of ["warehouseCode", "warehouseName", "description", "location", "isActive"]) {
      if (req.body[field] !== undefined) changes[field] = req.body[field];
    }
    if (changes.isActive !== undefined && typeof changes.isActive !== "boolean") {
      return res.status(400).json({ message: "isActive must be a boolean" });
    }
    if (changes.isActive === false && (await locationHasStock("warehouse", req.params.id))) {
      return res.status(409).json({ message: "Warehouse still contains stock. Move or issue the stock before deactivating it" });
    }
    const warehouse = await Warehouse.findByIdAndUpdate(req.params.id, changes, { returnDocument: "after", runValidators: true });

    if (!warehouse) {
      return res.status(404).json({ message: "Warehouse not found" });
    }

    await recordActivity(req, "warehouse.update", "Warehouse", warehouse._id, { fields: Object.keys(changes) });
    res.status(200).json({
      message: "Warehouse updated successfully",
      warehouse,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "Warehouse code already exists",
      });
    }
    res.status(400).json({ message: error.message });
  }
};

export const deleteWarehouse = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid warehouse ID" });
    }

    if (await locationHasStock("warehouse", req.params.id)) {
      return res.status(409).json({ message: "Warehouse still contains stock. Move or issue the stock before deactivating it" });
    }
    const warehouse = await Warehouse.findByIdAndUpdate(req.params.id, { isActive: false }, { returnDocument: "after", runValidators: true });

    if (!warehouse) {
      return res.status(404).json({ message: "Warehouse not found" });
    }

    await recordActivity(req, "warehouse.deactivate", "Warehouse", warehouse._id, { warehouseCode: warehouse.warehouseCode });
    res.status(200).json({ message: "Warehouse deactivated successfully", warehouse });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
