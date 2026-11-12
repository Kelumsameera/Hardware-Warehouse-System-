import express from "express";
import multer from "multer";

import { createItem, getItems, getItem, getItemFilters, updateItem, deleteItem, importItems, getItemAvailability, getItemAvailabilityDetail } from "../controllers/itemController.js";
import { uploadItemImage, deleteItemImage } from "../controllers/itemImageController.js";
import { authenticateToken, requirePermission } from "../middleware/authMiddleware.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (file.mimetype !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || !file.originalname.toLowerCase().endsWith(".xlsx")) {
      return callback(new Error("Only .xlsx files are allowed"));
    }
    return callback(null, true);
  },
});

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      return callback(new Error("Only JPEG, PNG, or WebP images are allowed"));
    }
    return callback(null, true);
  },
});

const parseExcelUpload = (req, res, next) => upload.single("file")(req, res, (error) => {
  if (error) return res.status(400).json({ message: error.message });
  return next();
});
const parseImageUpload = (req, res, next) => imageUpload.single("image")(req, res, (error) => {
  if (error) return res.status(400).json({ message: error.message });
  return next();
});
router.use(authenticateToken);
router.use(requirePermission("items"));
router.post("/import", requirePermission("items.write"), parseExcelUpload, importItems);
router.get("/filters", getItemFilters);
router.get("/availability", getItemAvailability);
router.get("/:id/availability", getItemAvailabilityDetail);
router.post("/", requirePermission("items.write"), createItem);
router.get("/", getItems);
router.get("/:id", getItem);
router.put("/:id", requirePermission("items.write"), updateItem);
router.delete("/:id", requirePermission("items.write"), deleteItem);
router.post("/:id/images", requirePermission("items.write"), parseImageUpload, uploadItemImage);
router.delete("/:id/images", requirePermission("items.write"), deleteItemImage);

export default router;
