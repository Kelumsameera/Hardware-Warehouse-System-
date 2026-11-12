import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import Activity from "../models/Activity.js";
import Item from "../models/Item.js";
import NewItemRequest, { NEW_ITEM_PRIORITIES, NEW_ITEM_STATUSES } from "../models/NewItemRequest.js";
import { notifyUsers } from "../services/notificationService.js";
import { UPLOAD_ROOT, detectImageType } from "./itemImageController.js";
import { nextNumber } from "./materialRequestController.js";

export const NEW_ITEM_CREATE_ROLES = ["Technician", "Super Admin", "Admin"];
export const NEW_ITEM_REVIEW_ROLES = ["Engineering Executive", "Super Admin", "Admin"];
const IMAGE_DIR = path.join(UPLOAD_ROOT, "new-items");
const MAX_LINES = 50;

const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const fail = (status, message) => Object.assign(new Error(message), { status });

const sendError = (res, error, fallback) => {
  if (error.status) return res.status(error.status).json({ message: error.message });
  if (error.name === "ValidationError" || error.name === "CastError") return res.status(400).json({ message: error.message });
  console.error(error);
  return res.status(500).json({ message: fallback });
};

const log = (req, action, request, details = {}) =>
  Activity.create({
    user: req.user.userId,
    action: `newItemRequest.${action}`,
    entityType: "NewItemRequest",
    entityId: request._id,
    details: { requestNumber: request.requestNumber, ...details },
    ipAddress: req.ip,
  });

const notifyReview = (request, req) => notifyUsers({
        rolePermissions: ["newItemRequests.review"],
        title: `New item request ${request.requestNumber} is awaiting review`,
        message: `${req.user.fullName} submitted a new item request for ${request.department}.`,
        type: "info",
        link: `/new-item-requests/view?id=${request._id}`,
        sourceType: "NewItemRequest",
        sourceId: request._id,
        metadata: { requestNumber: request.requestNumber },
        sendEmail: true,
      });

const imageFile = (imagePath) => {
  if (typeof imagePath !== "string" || !imagePath.startsWith("/uploads/new-items/")) return null;
  const name = path.basename(imagePath);
  return /^[a-f0-9]{32}\.(jpg|png|webp)$/.test(name) ? path.join(IMAGE_DIR, name) : null;
};

const removeImages = async (paths) => {
  for (const imagePath of paths) {
    const file = imageFile(imagePath);
    if (file) await fs.unlink(file).catch((error) => error.code !== "ENOENT" && console.error("Could not delete image:", error.message));
  }
};

// Owners see their own requests; the Engineering Executive (and admins) see submitted ones.
const canView = (request, user) =>
  String(request.requestedBy) === user.userId || (user.permissions?.["newItemRequests.review"] === true && request.status !== "DRAFT");

const loadVisible = async (req) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw fail(400, "Invalid request ID");
  const request = await NewItemRequest.findById(req.params.id);
  if (!request || !canView(request, req.user)) throw fail(404, "New item request not found");
  return request;
};

const loadOwnDraft = async (req) => {
  const request = await loadVisible(req);
  if (String(request.requestedBy) !== req.user.userId) throw fail(403, "Only the requester can change this request");
  if (request.status !== "DRAFT") throw fail(409, "Submitted requests are read-only");
  return request;
};

const readHeader = (body, changes = {}) => {
  for (const [field, max] of [["department", 120], ["projectName", 200], ["workOrderNumber", 60], ["justification", 2000], ["remarks", 1000]]) {
    if (body[field] !== undefined) changes[field] = text(body[field], max);
  }
  if (changes.department !== undefined && !changes.department) throw fail(400, "Department is required");
  if (body.priority !== undefined) {
    if (!NEW_ITEM_PRIORITIES.includes(body.priority)) throw fail(400, `Priority must be one of: ${NEW_ITEM_PRIORITIES.join(", ")}`);
    changes.priority = body.priority;
  }
  return changes;
};

// Existing lines keep their uploaded reference image; images are only set through the upload endpoint.
const readLines = (input, existing = []) => {
  if (!Array.isArray(input)) throw fail(400, "Items must be a list");
  if (input.length > MAX_LINES) throw fail(400, `A request cannot have more than ${MAX_LINES} items`);
  const byId = new Map(existing.map((line) => [String(line._id), line]));
  return input.map((line) => {
    const itemName = text(line?.itemName, 200);
    const unit = text(line?.unit, 40);
    const quantity = Number(line?.quantity);
    if (!itemName) throw fail(400, "Each item needs a name");
    if (!unit) throw fail(400, `${itemName}: unit is required`);
    if (!Number.isFinite(quantity) || quantity <= 0) throw fail(400, `${itemName}: quantity must be greater than zero`);
    const previous = line?._id && byId.get(String(line._id));
    return {
      ...(previous ? { _id: previous._id, referenceImage: previous.referenceImage } : {}),
      itemName,
      unit,
      quantity,
      description: text(line?.description, 1000),
      specification: text(line?.specification, 2000),
      remarks: text(line?.remarks, 500),
    };
  });
};

const checkReadyToSubmit = (request) => {
  if (!request.items.length) throw fail(400, "Add at least one item before submitting");
  if (!request.justification) throw fail(400, "Purpose / justification is required before submitting");
};

const listRequests = async (req, res, baseFilter) => {
  try {
    const filter = { ...baseFilter };
    if (!req.user.permissions?.["newItemRequests.review"] || req.query.mine === "true") filter.requestedBy = req.user.userId;
    else if (!filter.status) filter.$or = [{ status: { $ne: "DRAFT" } }, { requestedBy: req.user.userId }];
    if (req.query.status) {
      if (!NEW_ITEM_STATUSES.includes(req.query.status)) return res.status(400).json({ message: "Invalid status" });
      filter.status = req.query.status;
    }
    if (typeof req.query.search === "string" && req.query.search.trim()) {
      const search = escapeRegex(req.query.search.trim().slice(0, 100));
      filter.$and = [{ $or: ["requestNumber", "projectName", "workOrderNumber", "requestedByName", "items.itemName"].map((field) => ({ [field]: { $regex: search, $options: "i" } })) }];
    }
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const [requests, total] = await Promise.all([
      NewItemRequest.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      NewItemRequest.countDocuments(filter),
    ]);
    res.status(200).json({ requests, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    sendError(res, error, "New item requests could not be loaded");
  }
};

export const getNewItemRequests = (req, res) => listRequests(req, res, {});
export const getPendingReview = (req, res) => listRequests(req, res, { status: "PENDING_EXECUTIVE_REVIEW" });

export const getNewItemRequest = async (req, res) => {
  try {
    res.status(200).json({ request: await loadVisible(req) });
  } catch (error) {
    sendError(res, error, "New item request could not be loaded");
  }
};

// Possible duplicates in the Item master, so technicians check before asking for a new item.
export const findSimilarItems = async (req, res) => {
  try {
    const words = (typeof req.query.q === "string" ? req.query.q : "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 3)
      .slice(0, 6);
    if (!words.length) return res.status(200).json({ items: [] });
    const pattern = words.map(escapeRegex).join("|");
    const items = await Item.find({ isActive: true, $or: [{ itemCode: { $regex: pattern, $options: "i" } }, { description: { $regex: pattern, $options: "i" } }] })
      .select("itemCode description uom image itemGroup")
      .limit(50);
    const scored = items
      .map((item) => ({ item, score: words.filter((word) => `${item.itemCode} ${item.description}`.toLowerCase().includes(word)).length }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(({ item }) => item);
    res.status(200).json({ items: scored });
  } catch (error) {
    sendError(res, error, "Similar items could not be loaded");
  }
};

export const createNewItemRequest = async (req, res) => {
  try {
    const header = readHeader(req.body, { department: text(req.body.department, 120) });
    if (!header.department) return res.status(400).json({ message: "Department is required" });
    const items = readLines(req.body.items || []);
    const submit = req.body.submit === true;
    const draft = new NewItemRequest({
      ...header,
      items,
      requestNumber: await nextNumber("NIR"),
      requestedBy: req.user.userId,
      requestedByName: req.user.fullName,
    });
    if (submit) {
      checkReadyToSubmit(draft);
      draft.status = "PENDING_EXECUTIVE_REVIEW";
      draft.submittedAt = new Date();
    }
    await draft.save();
    await log(req, submit ? "submit" : "create", draft);
    if (submit) await notifyReview(draft, req);
    res.status(201).json({ message: submit ? "Request sent to the Engineering Executive" : "Draft saved", request: draft });
  } catch (error) {
    sendError(res, error, "New item request could not be created");
  }
};

export const updateNewItemRequest = async (req, res) => {
  try {
    const current = await loadOwnDraft(req);
    const changes = readHeader(req.body);
    let removedImages = [];
    if (req.body.items !== undefined) {
      changes.items = readLines(req.body.items, current.items);
      const kept = new Set(changes.items.map((line) => line.referenceImage).filter(Boolean));
      removedImages = current.items.map((line) => line.referenceImage).filter((image) => image && !kept.has(image));
    }
    const request = await NewItemRequest.findOneAndUpdate({ _id: current._id, status: "DRAFT" }, { $set: changes }, { returnDocument: "after", runValidators: true });
    if (!request) return res.status(409).json({ message: "Submitted requests are read-only" });
    await removeImages(removedImages);
    await log(req, "update", request, { fields: Object.keys(changes) });
    res.status(200).json({ message: "Draft updated", request });
  } catch (error) {
    sendError(res, error, "New item request could not be updated");
  }
};

export const deleteNewItemRequest = async (req, res) => {
  try {
    const current = await loadOwnDraft(req);
    const removed = await NewItemRequest.findOneAndDelete({ _id: current._id, status: "DRAFT" });
    if (!removed) return res.status(409).json({ message: "Submitted requests are read-only" });
    await removeImages(removed.items.map((line) => line.referenceImage).filter(Boolean));
    await log(req, "delete", removed);
    res.status(200).json({ message: "Draft deleted" });
  } catch (error) {
    sendError(res, error, "Draft could not be deleted");
  }
};

// Submission is the end of this workflow for now: the request waits for the Engineering Executive.
// Nothing is added to the Item master, stock is not touched, and no purchase document is created.
export const submitNewItemRequest = async (req, res) => {
  try {
    const current = await loadOwnDraft(req);
    checkReadyToSubmit(current);
    const request = await NewItemRequest.findOneAndUpdate(
      { _id: current._id, status: "DRAFT" },
      { $set: { status: "PENDING_EXECUTIVE_REVIEW", submittedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!request) return res.status(409).json({ message: "This request was already submitted" });
    await log(req, "submit", request);
    await notifyReview(request, req);
    res.status(200).json({ message: "Request sent to the Engineering Executive", request });
  } catch (error) {
    sendError(res, error, "New item request could not be submitted");
  }
};

export const uploadReferenceImage = async (req, res) => {
  let saved;
  try {
    const current = await loadOwnDraft(req);
    const line = current.items.id(req.params.lineId);
    if (!line) return res.status(404).json({ message: "Item line not found" });
    if (!req.file) return res.status(400).json({ message: "Image file is required" });
    const extension = detectImageType(req.file.buffer);
    if (!extension) return res.status(400).json({ message: "Only JPEG, PNG, or WebP images are allowed" });

    await fs.mkdir(IMAGE_DIR, { recursive: true });
    const name = `${crypto.randomBytes(16).toString("hex")}.${extension}`;
    saved = path.join(IMAGE_DIR, name);
    await fs.writeFile(saved, req.file.buffer, { flag: "wx" });
    const previous = line.referenceImage;
    const request = await NewItemRequest.findOneAndUpdate(
      { _id: current._id, status: "DRAFT", "items._id": line._id },
      { $set: { "items.$.referenceImage": `/uploads/new-items/${name}` } },
      { returnDocument: "after" },
    );
    if (!request) {
      await fs.unlink(saved);
      return res.status(409).json({ message: "Submitted requests are read-only" });
    }
    if (previous) await removeImages([previous]);
    res.status(201).json({ message: "Reference image uploaded", request });
  } catch (error) {
    if (saved && error.status === undefined) await fs.unlink(saved).catch(() => {});
    sendError(res, error, "Image could not be uploaded");
  }
};

export const deleteReferenceImage = async (req, res) => {
  try {
    const current = await loadOwnDraft(req);
    const line = current.items.id(req.params.lineId);
    if (!line?.referenceImage) return res.status(404).json({ message: "No reference image on this line" });
    const request = await NewItemRequest.findOneAndUpdate(
      { _id: current._id, status: "DRAFT", "items._id": line._id },
      { $set: { "items.$.referenceImage": null } },
      { returnDocument: "after" },
    );
    if (!request) return res.status(409).json({ message: "Submitted requests are read-only" });
    await removeImages([line.referenceImage]);
    res.status(200).json({ message: "Reference image removed", request });
  } catch (error) {
    sendError(res, error, "Image could not be removed");
  }
};
