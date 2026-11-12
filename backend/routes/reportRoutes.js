import express from "express";
import { exportBinStock, exportItems, exportLowStock, exportMovements, exportReorder, exportStockSummary, exportWarehouseStock } from "../controllers/reportController.js";
import { authenticateToken, requirePermission } from "../middleware/authMiddleware.js";

const router = express.Router();
router.use(authenticateToken, requirePermission("reports"));

router.get("/items.xlsx", exportItems);
router.get("/warehouse-stock.xlsx", exportWarehouseStock);
router.get("/bin-stock.xlsx", exportBinStock);
router.get("/movements.xlsx", exportMovements);
router.get("/low-stock.xlsx", exportLowStock);
router.get("/reorder.xlsx", exportReorder);
router.get("/summary.xlsx", exportStockSummary);

export default router;
