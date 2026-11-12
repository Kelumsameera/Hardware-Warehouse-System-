import express from "express";
import { getInventory, getInventorySummary, getWarehouseStock, getItemStock, getInventoryRecord, getStockSummary, changeReservation } from "../controllers/inventoryController.js";
import { authenticateToken, requirePermission } from "../middleware/authMiddleware.js";

const router = express.Router();
router.use(authenticateToken, requirePermission("inventory"));


router.get("/summary", getStockSummary);
router.get("/summary/by-location", getInventorySummary);
router.get("/warehouse/:id", getWarehouseStock);
router.get("/item/:id", getItemStock);
router.post("/:id/reserve", requirePermission("inventory.reserve"), (req, res) => changeReservation(req, res, "reserve"));
router.post("/:id/release", requirePermission("inventory.reserve"), (req, res) => changeReservation(req, res, "release"));
router.get("/", getInventory);
router.get("/:id", getInventoryRecord);

export default router;
