import express from "express";
import { adjustStock, getStockMovements, issueStock, receiveStock, returnStock, transferStock } from "../controllers/stockMovementController.js";
import { authenticateToken, requirePermission } from "../middleware/authMiddleware.js";

const router = express.Router();
router.use(authenticateToken, requirePermission("movements"));

router.get("/", getStockMovements);
router.post("/receipts", requirePermission("movements.write"), receiveStock);
router.post("/issues", requirePermission("movements.write"), issueStock);
router.post("/transfers", requirePermission("movements.write"), transferStock);
router.post("/adjustments", requirePermission("movements.adjust"), adjustStock);
router.post("/returns", requirePermission("movements.write"), returnStock);

export default router;
