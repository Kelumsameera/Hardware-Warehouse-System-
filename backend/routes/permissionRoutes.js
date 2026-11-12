import express from "express";
import { authenticateToken, requireRoles } from "../middleware/authMiddleware.js";
import { getRolePermissions, saveRolePermissions, getPermissionAuditLog } from "../controllers/permissionController.js";

const router = express.Router();

router.use(authenticateToken);
router.get("/roles", requireRoles("Super Admin"), getRolePermissions);
router.put("/roles/:role", requireRoles("Super Admin"), saveRolePermissions);
router.get("/audit", requireRoles("Super Admin"), getPermissionAuditLog);

export default router;
