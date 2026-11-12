import express from "express";
import { createZone, getZones, getZone, updateZone, deleteZone } from "../controllers/zoneController.js";
import { authenticateToken, requirePermission } from "../middleware/authMiddleware.js";

const router = express.Router();
router.use(authenticateToken, requirePermission("warehouses"));


router.post("/", requirePermission("warehouses.write"), createZone);
router.get("/", getZones);
router.get("/:id", getZone);
router.put("/:id", requirePermission("warehouses.write"), updateZone);
router.delete("/:id", requirePermission("warehouses.write"), deleteZone);

export default router;
