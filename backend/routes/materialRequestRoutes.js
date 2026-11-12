import express from "express";
import {
  approveMaterialRequest,
  createMaterialRequest,
  deleteDraft,
  getAuditHistory,
  getIssueHistory,
  getIssueQueue,
  getMaterialRequest,
  getMaterialRequests,
  getPendingApprovals,
  getStockAvailability,
  holdMaterialRequest,
  issueFull,
  issuePartial,
  receiveMaterialRequest,
  rejectMaterialRequest,
  resumeMaterialRequest,
  submitMaterialRequest,
  updateDraft,
} from "../controllers/materialRequestController.js";
import { authenticateToken, requirePermission } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(authenticateToken);
router.use(requirePermission("materialRequests"));
router.get("/", getMaterialRequests);
router.post("/", requirePermission("materialRequests.create"), createMaterialRequest);
router.get("/approvals", requirePermission("materialRequests.approve"), getPendingApprovals);
router.get("/issue-queue", requirePermission("materialRequests.issue"), getIssueQueue);
router.get("/:id", getMaterialRequest);
router.put("/:id", requirePermission("materialRequests.create"), updateDraft);
router.delete("/:id", requirePermission("materialRequests.create"), deleteDraft);
router.post("/:id/submit", requirePermission("materialRequests.create"), submitMaterialRequest);
router.post("/:id/approve", requirePermission("materialRequests.approve"), approveMaterialRequest);
router.post("/:id/reject", requirePermission("materialRequests.approve"), rejectMaterialRequest);
router.get("/:id/stock", requirePermission("materialRequests.issue"), getStockAvailability);
router.post("/:id/issue-full", requirePermission("materialRequests.issue"), issueFull);
router.post("/:id/issue-partial", requirePermission("materialRequests.issue"), issuePartial);
router.post("/:id/hold", requirePermission("materialRequests.issue"), holdMaterialRequest);
router.post("/:id/resume", requirePermission("materialRequests.issue"), resumeMaterialRequest);
router.get("/:id/issues", getIssueHistory);
router.post("/:id/receive", requirePermission("materialRequests.receive"), receiveMaterialRequest);
router.get("/:id/audit", getAuditHistory);

export default router;
