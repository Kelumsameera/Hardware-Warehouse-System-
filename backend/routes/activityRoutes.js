import express from "express";
import { getActivities } from "../controllers/activityController.js";
import { authenticateToken, requirePermission } from "../middleware/authMiddleware.js";

const router = express.Router();
router.use(authenticateToken, requirePermission("activities"));

router.get("/", getActivities);

export default router;
