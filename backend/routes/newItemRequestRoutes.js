import express from "express";
import multer from "multer";
import {
  createNewItemRequest,
  deleteNewItemRequest,
  deleteReferenceImage,
  findSimilarItems,
  getNewItemRequest,
  getNewItemRequests,
  getPendingReview,
  submitNewItemRequest,
  updateNewItemRequest,
  uploadReferenceImage,
} from "../controllers/newItemRequestController.js";
import { authenticateToken, requirePermission } from "../middleware/authMiddleware.js";

const router = express.Router();

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) return callback(new Error("Only JPEG, PNG, or WebP images are allowed"));
    return callback(null, true);
  },
});
const parseImage = (req, res, next) => imageUpload.single("image")(req, res, (error) => {
  if (error) return res.status(400).json({ message: error.message });
  return next();
});

router.use(authenticateToken);
router.use(requirePermission("newItemRequests"));
router.get("/", getNewItemRequests);
router.post("/", requirePermission("newItemRequests.create"), createNewItemRequest);
router.get("/pending", requirePermission("newItemRequests.review"), getPendingReview);
router.get("/similar-items", findSimilarItems);
router.get("/:id", getNewItemRequest);
router.put("/:id", requirePermission("newItemRequests.create"), updateNewItemRequest);
router.delete("/:id", requirePermission("newItemRequests.create"), deleteNewItemRequest);
router.post("/:id/submit", requirePermission("newItemRequests.create"), submitNewItemRequest);
router.post("/:id/items/:lineId/image", requirePermission("newItemRequests.create"), parseImage, uploadReferenceImage);
router.delete("/:id/items/:lineId/image", requirePermission("newItemRequests.create"), deleteReferenceImage);

export default router;
