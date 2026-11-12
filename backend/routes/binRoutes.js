import express from "express";
import { createBin, getBins, getBin, updateBin, deleteBin, deactivateBin, reactivateBin, suggestBins } from "../controllers/binController.js";
import { authenticateToken, requirePermission } from "../middleware/authMiddleware.js";

const router = express.Router();
router.use(authenticateToken, requirePermission("warehouses"));

router.get("/suggest", requirePermission("movements.write"), suggestBins);
router.post("/", requirePermission("warehouses.write"), createBin);
router.get("/", getBins);
router.get("/:id", getBin);
router.put("/:id", requirePermission("warehouses.write"), updateBin);
router.delete("/:id", requirePermission("warehouses.write"), deleteBin);
router.patch("/:id/deactivate", requirePermission("warehouses.write"), deactivateBin);
router.patch("/:id/reactivate", requirePermission("warehouses.write"), reactivateBin);

export default router;
