import mongoose from "mongoose";
import Zone from "../models/Zone.js";
import Warehouse from "../models/Warehouse.js";
import { recordActivity } from "./activityController.js";
import { locationHasStock } from "./locationHelpers.js";

export const createZone = async (req, res) => {
  try {
    const { warehouse, zoneCode, zoneName, description } = req.body;

    if (!mongoose.isValidObjectId(warehouse)) {
      return res.status(400).json({ message: "Invalid warehouse ID" });
    }

    const existingWarehouse = await Warehouse.findById(warehouse);

    if (!existingWarehouse || !existingWarehouse.isActive) {
      return res.status(404).json({ message: "Active warehouse not found" });
    }

    const zone = await Zone.create({
      warehouse,
      zoneCode,
      zoneName,
      description,
    });

    await recordActivity(req, "zone.create", "Zone", zone._id, { zoneCode: zone.zoneCode });
    res.status(201).json({
      message: "Zone created successfully",
      zone,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Zone code already exists in this warehouse" });
    }

    res.status(400).json({ message: error.message });
  }
};

export const getZones = async (req, res) => {
  try {
    const filter = {};

    if (req.query.warehouse) {
      if (!mongoose.isValidObjectId(req.query.warehouse)) {
        return res.status(400).json({ message: "Invalid warehouse ID" });
      }
      filter.warehouse = req.query.warehouse;
    }

    const zones = await Zone.find(filter).populate("warehouse", "warehouseCode warehouseName").sort({ zoneCode: 1 });

    res.status(200).json(zones);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getZone = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid zone ID" });
    }

    const zone = await Zone.findById(req.params.id).populate("warehouse", "warehouseCode warehouseName");

    if (!zone) {
      return res.status(404).json({ message: "Zone not found" });
    }

    res.status(200).json(zone);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateZone = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid zone ID" });
    }

    const { zoneCode, zoneName, description, isActive } = req.body;

    const changes = {};
    if (zoneCode !== undefined) changes.zoneCode = zoneCode;
    if (zoneName !== undefined) changes.zoneName = zoneName;
    if (description !== undefined) changes.description = description;
    if (isActive !== undefined) {
      if (typeof isActive !== "boolean") return res.status(400).json({ message: "isActive must be a boolean" });
      changes.isActive = isActive;
    }
    if (isActive === false && (await locationHasStock("zone", req.params.id))) {
      return res.status(409).json({ message: "Zone still contains stock. Move or issue the stock before deactivating it" });
    }
    if (isActive === true) {
      const current = await Zone.findById(req.params.id).populate("warehouse");
      if (!current) return res.status(404).json({ message: "Zone not found" });
      if (!current.warehouse?.isActive) return res.status(400).json({ message: "Active warehouse is required" });
    }

    const zone = await Zone.findByIdAndUpdate(req.params.id, changes, {
      returnDocument: "after",
      runValidators: true,
    });

    if (!zone) {
      return res.status(404).json({ message: "Zone not found" });
    }

    await recordActivity(req, "zone.update", "Zone", zone._id, { fields: Object.keys(changes) });
    res.status(200).json({
      message: "Zone updated successfully",
      zone,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Zone code already exists in this warehouse" });
    }

    res.status(400).json({ message: error.message });
  }
};

export const deleteZone = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid zone ID" });
    }

    if (await locationHasStock("zone", req.params.id)) {
      return res.status(409).json({ message: "Zone still contains stock. Move or issue the stock before deactivating it" });
    }
    const zone = await Zone.findByIdAndUpdate(req.params.id, { isActive: false }, { returnDocument: "after" });

    if (!zone) {
      return res.status(404).json({ message: "Zone not found" });
    }

    await recordActivity(req, "zone.deactivate", "Zone", zone._id, { zoneCode: zone.zoneCode });
    res.status(200).json({ message: "Zone deactivated successfully", zone });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
