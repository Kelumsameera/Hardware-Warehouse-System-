import express from "express";
import { getDashboard } from "../controllers/dashboardController.js";
import { authenticateToken, requirePermission } from "../middleware/authMiddleware.js";

const router = express.Router();
router.use(authenticateToken, requirePermission("dashboard"));

router.get("/", getDashboard);

export default router;
