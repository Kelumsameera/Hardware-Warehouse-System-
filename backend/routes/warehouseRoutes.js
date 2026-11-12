import express from "express";

import { createWarehouse, getWarehouses, getWarehouse, updateWarehouse, deleteWarehouse } from "../controllers/warehouseController.js";
import { authenticateToken, requirePermission } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(authenticateToken);
router.use(requirePermission("warehouses"));
router.post("/", requirePermission("warehouses.write"), createWarehouse);
router.get("/", getWarehouses);
router.get("/:id", getWarehouse);
router.put("/:id", requirePermission("warehouses.write"), updateWarehouse);
router.delete("/:id", requirePermission("warehouses.write"), deleteWarehouse);

export default router;
