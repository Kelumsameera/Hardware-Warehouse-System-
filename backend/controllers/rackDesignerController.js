import mongoose from "mongoose";
import Rack from "../models/Rack.js";
import Level from "../models/Level.js";
import Bin from "../models/Bin.js";
import Inventory from "../models/Inventory.js";
import Zone from "../models/Zone.js";
import Warehouse from "../models/Warehouse.js";
import Activity from "../models/Activity.js";

export async function getRackGrid(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid rack ID" });
  const rack = await Rack.findById(req.params.id).lean();
  if (!rack) return res.status(404).json({ message: "Rack not found" });
  const levels = await Level.find({ rack: rack._id }).sort({ levelNumber: 1 }).lean();
  const bins = await Bin.find({ level: { $in: levels.map((row) => row._id) } }).lean();
  const inventory = await Inventory.find({ bin: { $in: bins.map((bin) => bin._id) }, quantity: { $gt: 0 } })
    .populate("item", "itemCode description uom").lean();
  res.json({ rack, levels, bins: bins.map((bin) => ({ ...bin, inventory: inventory.filter((entry) => String(entry.bin) === String(bin._id)) })) });
}
export async function resizeRackGrid(req, res) {
  const { rows, columns } = req.body || {};
  if (!mongoose.isValidObjectId(req.params.id) || !Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || rows > 20 || columns < 1 || columns > 20) {
    return res.status(400).json({ message: "Rows and columns must be integers between 1 and 20" });
  }
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const rack = await Rack.findById(req.params.id).session(session);
      if (!rack?.isActive) throw Object.assign(new Error("Active rack required"), { status: 404 });
      const zone = await Zone.findById(rack.zone).session(session);
      const warehouse = zone && await Warehouse.findById(zone.warehouse).session(session);
      if (!zone?.isActive || !warehouse?.isActive) throw Object.assign(new Error("Active warehouse and zone required"), { status: 409 });
      const levels = await Level.find({ rack: rack._id }).sort({ levelNumber: 1, _id: 1 }).session(session);
      if (new Set(levels.map((level) => level.levelNumber)).size !== levels.length) throw Object.assign(new Error("Rack has duplicate level numbers. Renumber levels before configuring the grid."), { status: 409 });
      for (const level of levels) {
        if (level.levelNumber > rows) {
          const bins = await Bin.find({ level: level._id }).session(session);
          for (const bin of bins) await archiveForResize(bin, session);
          level.isActive = false;
          await level.save({ session });
        }
      }
      for (let row = 1; row <= rows; row++) {
        let level = levels.find((entry) => entry.levelNumber === row);
        if (!level) [level] = await Level.create([{ rack: rack._id, levelNumber: row, levelCode: `GRID-${row}`, levelName: `Row ${row}` }], { session });
        else if (!level.isActive) { level.isActive = true; await level.save({ session }); }
        const bins = await Bin.find({ level: level._id }).sort({ binCode: 1 }).session(session);
        const used = new Set(bins.filter((bin) => bin.gridColumn).map((bin) => bin.gridColumn));
        // Adopt existing bins without replacing their IDs or location history.
        for (const bin of bins.filter((entry) => !entry.gridColumn && !entry.archivedAt)) {
          let column = 1;
          while (used.has(column)) column++;
          if (column > columns) throw Object.assign(new Error("Existing bins exceed grid width. Increase columns or archive unused bins first."), { status: 409 });
          bin.gridColumn = column; used.add(column); await bin.save({ session });
        }
        for (const bin of bins) if (bin.gridColumn > columns) await archiveForResize(bin, session);
        for (let column = 1; column <= columns; column++) {
          if (used.has(column)) continue;
          await Bin.create([{ level: level._id, binCode: `GRID-${column}-${new mongoose.Types.ObjectId().toString().slice(-6)}`, binName: `Row ${row} / Bin ${column}`, gridColumn: column }], { session });
        }
      }
      rack.gridRows = rows; rack.gridColumns = columns; await rack.save({ session });
      await Activity.create([{ user: req.user.userId, action: "rack.resize", entityType: "Rack", entityId: rack._id, details: { rows, columns }, ipAddress: req.ip }], { session });
    });
    return getRackGrid(req, res);
  } catch (error) {
    res.status(error.status || (error.code === 11000 ? 409 : 500)).json({ message: error.status ? error.message : "Grid could not be saved; transaction-capable MongoDB required" });
  } finally { await session.endSession(); }
}
async function archiveForResize(bin, session) {
  if (await Inventory.exists({ bin: bin._id, $or: [{ quantity: { $gt: 0 } }, { reservedQuantity: { $gt: 0 } }] }).session(session)) {
    throw Object.assign(new Error("Occupied bins cannot be removed from the grid"), { status: 409 });
  }
  bin.isActive = false; bin.gridColumn = null; bin.archivedAt = bin.archivedAt || new Date();
  await bin.save({ session });
}
