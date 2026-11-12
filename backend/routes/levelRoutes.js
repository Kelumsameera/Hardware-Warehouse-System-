import express from "express";
import { createLevel, getLevels, getLevel, updateLevel, deleteLevel, deactivateLevel, reactivateLevel } from "../controllers/levelController.js";
import { authenticateToken, requirePermission } from "../middleware/authMiddleware.js";

const router = express.Router();
router.use(authenticateToken, requirePermission("warehouses"));

router.post("/", requirePermission("warehouses.write"), createLevel);
router.get("/", getLevels);
router.get("/:id", getLevel);
router.put("/:id", requirePermission("warehouses.write"), updateLevel);
router.delete("/:id", requirePermission("warehouses.write"), deleteLevel);
router.patch("/:id/deactivate", requirePermission("warehouses.write"), deactivateLevel);
router.patch("/:id/reactivate", requirePermission("warehouses.write"), reactivateLevel);

export default router;
