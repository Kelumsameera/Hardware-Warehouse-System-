import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import Item from "../models/Item.js";
import { recordActivity } from "./activityController.js";

export const UPLOAD_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "uploads");
const ITEM_IMAGE_DIR = path.join(UPLOAD_ROOT, "items");
const MAX_IMAGES_PER_ITEM = 10;

// Detect the real file type from its first bytes instead of trusting the browser's mimetype.
export const detectImageType = (buffer) => {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
};

const imageFilePath = (imagePath) => {
  if (typeof imagePath !== "string" || !imagePath.startsWith("/uploads/items/")) return null;
  const fileName = path.basename(imagePath);
  if (!/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(fileName)) return null;
  return path.join(ITEM_IMAGE_DIR, fileName);
};

export const uploadItemImage = async (req, res) => {
  let savedFile;
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid item ID" });
    if (!req.file) return res.status(400).json({ message: "Image file is required" });
    const extension = detectImageType(req.file.buffer);
    if (!extension) return res.status(400).json({ message: "Only JPEG, PNG, or WebP images are allowed" });

    const item = await Item.findById(req.params.id).select("images image itemCode");
    if (!item) return res.status(404).json({ message: "Item not found" });
    if (item.images.length >= MAX_IMAGES_PER_ITEM) {
      return res.status(400).json({ message: `An item can have at most ${MAX_IMAGES_PER_ITEM} images` });
    }

    await fs.mkdir(ITEM_IMAGE_DIR, { recursive: true });
    const fileName = `${crypto.randomBytes(16).toString("hex")}.${extension}`;
    savedFile = path.join(ITEM_IMAGE_DIR, fileName);
    await fs.writeFile(savedFile, req.file.buffer, { flag: "wx" });
    const imagePath = `/uploads/items/${fileName}`;

    const updated = await Item.findOneAndUpdate(
      { _id: item._id, [`images.${MAX_IMAGES_PER_ITEM - 1}`]: { $exists: false } },
      { $push: { images: imagePath } },
      { returnDocument: "after" },
    );
    if (!updated) {
      await fs.unlink(savedFile);
      return res.status(400).json({ message: `An item can have at most ${MAX_IMAGES_PER_ITEM} images` });
    }
    if (!updated.image) {
      updated.image = imagePath;
      await updated.save();
    }
    await recordActivity(req, "item.image.add", "Item", updated._id, { itemCode: updated.itemCode, image: imagePath });
    res.status(201).json({ message: "Image uploaded successfully", item: updated });
  } catch (error) {
    if (savedFile) await fs.unlink(savedFile).catch(() => {});
    res.status(500).json({ message: error.message });
  }
};

export const deleteItemImage = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid item ID" });
    const imagePath = req.body?.image;
    const filePath = imageFilePath(imagePath);
    if (!filePath) return res.status(400).json({ message: "A valid uploaded image path is required" });

    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ message: "Item not found" });
    if (!item.images.includes(imagePath)) return res.status(404).json({ message: "Image not found on this item" });

    item.images = item.images.filter((image) => image !== imagePath);
    if (item.image === imagePath) item.image = item.images[0] || null;
    await item.save();
    await fs.unlink(filePath).catch((error) => {
      if (error.code !== "ENOENT") console.error("Could not delete item image file:", error.message);
    });
    await recordActivity(req, "item.image.remove", "Item", item._id, { itemCode: item.itemCode, image: imagePath });
    res.status(200).json({ message: "Image removed successfully", item });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
