import Bin from "../models/Bin.js";
import Inventory from "../models/Inventory.js";
import Level from "../models/Level.js";
import Rack from "../models/Rack.js";
import Zone from "../models/Zone.js";

// Returns the bin IDs that sit underneath a warehouse, zone, rack, or level.
export const getBinIdsUnder = async (locationType, id) => {
  let zoneIds;
  let rackIds;
  let levelIds;
  if (locationType === "warehouse") zoneIds = await Zone.find({ warehouse: id }).distinct("_id");
  if (locationType === "zone") zoneIds = [id];
  if (zoneIds) rackIds = await Rack.find({ zone: { $in: zoneIds } }).distinct("_id");
  if (locationType === "rack") rackIds = [id];
  if (rackIds) levelIds = await Level.find({ rack: { $in: rackIds } }).distinct("_id");
  if (locationType === "level") levelIds = [id];
  return Bin.find({ level: { $in: levelIds || [] } }).distinct("_id");
};

// Deactivating a location that still holds stock would strand that stock,
// because movements require every parent location to be active.
export const locationHasStock = async (locationType, id) => {
  const binIds = await getBinIdsUnder(locationType, id);
  if (!binIds.length) return false;
  return Boolean(await Inventory.exists({ bin: { $in: binIds }, quantity: { $gt: 0 } }));
};
