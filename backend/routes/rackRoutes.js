import { getRackGrid, resizeRackGrid } from "../controllers/rackDesignerController.js";
import express from "express";
import { createRack, getRacks, getRack, updateRack, deleteRack, deactivateRack, reactivateRack } from "../controllers/rackController.js";
import { authenticateToken, requirePermission } from "../middleware/authMiddleware.js";

const router = express.Router();
router.use(authenticateToken, requirePermission("warehouses"));

router.get("/:id/grid", getRackGrid);
router.put("/:id/grid", requirePermission("warehouses.write"), resizeRackGrid);
router.post("/", requirePermission("warehouses.write"), createRack);
router.get("/", getRacks);
router.get("/:id", getRack);
router.put("/:id", requirePermission("warehouses.write"), updateRack);
router.delete("/:id", requirePermission("warehouses.write"), deleteRack);
router.patch("/:id/deactivate", requirePermission("warehouses.write"), deactivateRack);
router.patch("/:id/reactivate", requirePermission("warehouses.write"), reactivateRack);

export default router;
