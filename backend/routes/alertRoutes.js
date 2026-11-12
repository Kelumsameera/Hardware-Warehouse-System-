import express from "express";
import { getStockAlerts } from "../controllers/alertController.js";
import { authenticateToken, requirePermission } from "../middleware/authMiddleware.js";

const router = express.Router();
router.use(authenticateToken, requirePermission("alerts"));

router.get("/", getStockAlerts);
router.get("/:type", getStockAlerts);

export default router;
