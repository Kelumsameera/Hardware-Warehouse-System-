import mongoose from "mongoose";
import Activity from "../models/Activity.js";
import Inventory from "../models/Inventory.js";
import Item from "../models/Item.js";
import MaterialRequest, { MR_STATUSES } from "../models/MaterialRequest.js";
import MaterialRequestAudit from "../models/MaterialRequestAudit.js";
import MaterialRequestIssue from "../models/MaterialRequestIssue.js";
import StockMovement from "../models/StockMovement.js";
import { notifyUsers } from "../services/notificationService.js";
import { fail, isTransactionUnavailable, removeStock, touchBin, validateBinHierarchy } from "./stockMovementController.js";

export const MR_CREATE_ROLES = ["Technician", "Super Admin", "Admin"];
export const MR_APPROVER_ROLES = ["Engineering Executive", "Engineering Manager"];
export const MR_STORE_ROLES = ["Store Keeper", "Super Admin", "Admin"];
const ISSUABLE = ["PENDING_ISSUE", "PARTIALLY_ISSUED"];
const MAX_LINES = 50;

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const roundQty = (value) => Math.round(value * 1e6) / 1e6;

const formatRequest = (mr, images = new Map()) => {
  const data = mr.toObject ? mr.toObject() : mr;
  data.items = data.items.map((line) => ({
    ...line,
    image: images.get(String(line.item)) || null,
    remainingQuantity: roundQty(line.requestedQuantity - line.issuedQuantity),
    pendingReceiptQuantity: roundQty(line.issuedQuantity - (line.receivedQuantity || 0)),
  }));
  return data;
};

// Adds the current primary image from the Item master to every line.
const present = async (input) => {
  const list = Array.isArray(input) ? input : [input];
  const ids = [...new Set(list.flatMap((mr) => mr.items.map((line) => String(line.item))))];
  const items = ids.length ? await Item.find({ _id: { $in: ids } }).select("image") : [];
  const images = new Map(items.map((item) => [String(item._id), item.image]));
  const result = list.map((mr) => formatRequest(mr, images));
  return Array.isArray(input) ? result : result[0];
};

const actor = (req) => ({ user: req.user.userId, name: req.user.fullName, role: req.user.role, date: new Date() });

const addAudit = (mr, req, action, fromStatus, toStatus, remarks = "", details = {}, session) =>
  MaterialRequestAudit.create([{
    materialRequest: mr._id,
    action,
    fromStatus,
    toStatus,
    user: req.user.userId,
    userName: req.user.fullName,
    role: req.user.role,
    remarks,
    details,
    ipAddress: req.ip,
  }], { session });

const runTransaction = async (work) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};

const notifyRequestStakeholders = async ({ mr, title, message, type = "info", link = null, metadata = {}, byUser = null }) => {
  const priority = [];
  if (mr?.requestedBy) priority.push(String(mr.requestedBy));
  if (byUser) priority.push(String(byUser));
  const uniqueIds = [...new Set(priority)];
  await notifyUsers({
    userIds: uniqueIds,
    rolePermissions: ["materialRequests.review", "materialRequests.approve", "materialRequests.issue"],
    title,
    message,
    type,
    link,
    sourceType: "MaterialRequest",
    sourceId: mr?._id || null,
    metadata: { ...metadata, eventKey: mr?.updatedAt?.toISOString(), actorName: byUser ? (metadata.actorName || byUser) : metadata.actorName || null },
    sendEmail: true,
  });
};

const sendError = (res, error, fallback) => {
  if (error.status) return res.status(error.status).json({ message: error.message });
  if (isTransactionUnavailable(error)) {
    return res.status(503).json({ message: "Material requests require MongoDB replica set or transaction-capable configuration" });
  }
  if (error.name === "ValidationError" || error.name === "CastError") return res.status(400).json({ message: error.message });
  console.error(error);
  return res.status(500).json({ message: fallback });
};

// MR-2026-000001. The counter is a single atomic $inc, so concurrent creates never get the same number.
export const nextNumber = async (prefix) => {
  const year = new Date().getFullYear();
  const counter = await mongoose.connection.db.collection("counters").findOneAndUpdate(
    { _id: `${prefix}-${year}` },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  );
  const seq = (counter?.value ?? counter)?.seq;
  return `${prefix}-${year}-${String(seq).padStart(6, "0")}`;
};

// Item code, description, and unit come from the Item master, never from the client.
const buildLines = async (input) => {
  if (!Array.isArray(input) || input.length === 0) throw fail(400, "At least one item is required");
  if (input.length > MAX_LINES) throw fail(400, `A request cannot have more than ${MAX_LINES} items`);
  const ids = input.map((line) => line?.item);
  if (ids.some((id) => !mongoose.isValidObjectId(id))) throw fail(400, "Each line needs a valid item");
  if (new Set(ids.map(String)).size !== ids.length) throw fail(400, "Each item can appear only once; combine the quantities");

  const items = await Item.find({ _id: { $in: ids } }).select("itemCode description uom isActive");
  const byId = new Map(items.map((item) => [String(item._id), item]));
  return input.map((line) => {
    const item = byId.get(String(line.item));
    if (!item?.isActive) throw fail(400, "One of the selected items is not an active item");
    const requestedQuantity = Number(line.requestedQuantity);
    if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
      throw fail(400, `Requested quantity for ${item.itemCode} must be greater than zero`);
    }
    return {
      item: item._id,
      itemCode: item.itemCode,
      description: item.description,
      uom: item.uom || "",
      requestedQuantity,
      remarks: text(line.remarks, 500),
    };
  });
};

const canView = (mr, user) => {
  if (String(mr.requestedBy) === user.userId) return true;
  if (!["materialRequests.review", "materialRequests.approve", "materialRequests.issue"].some((key) => user.permissions?.[key] === true)) return false;
  return mr.status !== "DRAFT";
};

const loadVisible = async (req) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw fail(400, "Invalid material request ID");
  const mr = await MaterialRequest.findById(req.params.id);
  if (!mr || !canView(mr, req.user)) throw fail(404, "Material request not found");
  return mr;
};

const listRequests = async (req, res, baseFilter, defaultStatuses) => {
  try {
    const filter = { ...baseFilter };
    if (defaultStatuses && !req.query.status) filter.status = { $in: defaultStatuses };
    if (!["materialRequests.review", "materialRequests.approve", "materialRequests.issue"].some((key) => req.user.permissions?.[key] === true)) filter.requestedBy = req.user.userId;
    else if (req.query.mine === "true") filter.requestedBy = req.user.userId;
    else if (!filter.status) filter.$or = [{ status: { $ne: "DRAFT" } }, { requestedBy: req.user.userId }];

    if (req.query.status) {
      if (!MR_STATUSES.includes(req.query.status)) return res.status(400).json({ message: "Invalid status" });
      if (filter.status?.$in && !filter.status.$in.includes(req.query.status)) return res.status(200).json({ requests: [], total: 0, page: 1, totalPages: 0 });
      filter.status = req.query.status;
    }
    if (typeof req.query.search === "string" && req.query.search.trim()) {
      const search = escapeRegex(req.query.search.trim().slice(0, 100));
      const searchFilter = ["mrNumber", "workOrderNumber", "department", "requestedByName", "items.itemCode"].map((field) => ({ [field]: { $regex: search, $options: "i" } }));
      filter.$and = [{ $or: searchFilter }];
    }
    for (const [param, operator] of [["startDate", "$gte"], ["endDate", "$lte"]]) {
      if (!req.query[param]) continue;
      const date = new Date(req.query[param]);
      if (Number.isNaN(date.getTime())) return res.status(400).json({ message: `Invalid ${param}` });
      filter.requestDate = { ...filter.requestDate, [operator]: date };
    }
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const [requests, total] = await Promise.all([
      MaterialRequest.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      MaterialRequest.countDocuments(filter),
    ]);
    res.status(200).json({ requests: await present(requests), total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    sendError(res, error, "Material requests could not be loaded");
  }
};

export const getMaterialRequests = (req, res) => listRequests(req, res, {});
export const getPendingApprovals = (req, res) => listRequests(req, res, { status: "PENDING_APPROVAL" });
export const getIssueQueue = (req, res) => listRequests(req, res, { status: { $in: ["PENDING_ISSUE", "PARTIALLY_ISSUED", "ON_HOLD", "ISSUED"] } }, ["PENDING_ISSUE", "PARTIALLY_ISSUED", "ON_HOLD"]);

export const getMaterialRequest = async (req, res) => {
  try {
    const mr = await loadVisible(req);
    res.status(200).json({ materialRequest: await present(mr) });
  } catch (error) {
    sendError(res, error, "Material request could not be loaded");
  }
};

export const createMaterialRequest = async (req, res) => {
  try {
    const department = text(req.body.department, 120);
    if (!department) return res.status(400).json({ message: "Department is required" });
    const items = await buildLines(req.body.items);
    const submit = req.body.submit === true;
    const mrNumber = await nextNumber("MR");

    const mr = await runTransaction(async (session) => {
      const [created] = await MaterialRequest.create([{
        mrNumber,
        department,
        workOrderNumber: text(req.body.workOrderNumber, 60),
        requestedBy: req.user.userId,
        requestedByName: req.user.fullName,
        remarks: text(req.body.remarks, 1000),
        items,
        status: submit ? "PENDING_APPROVAL" : "DRAFT",
        submittedAt: submit ? new Date() : null,
      }], { session });
      await addAudit(created, req, "created", null, "DRAFT", "", { items: items.length }, session);
      if (submit) await addAudit(created, req, "submitted", "DRAFT", "PENDING_APPROVAL", "", {}, session);
      return created;
    });
    if (submit) {
      await notifyRequestStakeholders({
        mr,
        title: `MR ${mr.mrNumber} submitted for approval`,
        message: `${req.user.fullName} submitted a material request for ${mr.department}.`,
        type: "info",
        link: `/material-requests/view?id=${mr._id}`,
        metadata: { requestNumber: mr.mrNumber, eventKey: mr.updatedAt.toISOString() },
        byUser: req.user.userId,
      });
    }
    res.status(201).json({ message: submit ? "Material request submitted for approval" : "Draft saved", materialRequest: await present(mr) });
  } catch (error) {
    sendError(res, error, "Material request could not be created");
  }
};

export const updateDraft = async (req, res) => {
  try {
    const current = await loadVisible(req);
    if (String(current.requestedBy) !== req.user.userId) return res.status(403).json({ message: "Only the requester can edit this request" });

    const changes = {};
    if (req.body.department !== undefined) {
      changes.department = text(req.body.department, 120);
      if (!changes.department) return res.status(400).json({ message: "Department is required" });
    }
    if (req.body.workOrderNumber !== undefined) changes.workOrderNumber = text(req.body.workOrderNumber, 60);
    if (req.body.remarks !== undefined) changes.remarks = text(req.body.remarks, 1000);
    if (req.body.items !== undefined) changes.items = await buildLines(req.body.items);

    const mr = await runTransaction(async (session) => {
      const updated = await MaterialRequest.findOneAndUpdate(
        { _id: current._id, status: "DRAFT" },
        { $set: changes },
        { returnDocument: "after", runValidators: true, session },
      );
      if (!updated) throw fail(409, "Only draft requests can be edited");
      await addAudit(updated, req, "updated", "DRAFT", "DRAFT", "", { fields: Object.keys(changes) }, session);
      return updated;
    });
    res.status(200).json({ message: "Draft updated", materialRequest: await present(mr) });
  } catch (error) {
    sendError(res, error, "Material request could not be updated");
  }
};

export const deleteDraft = async (req, res) => {
  try {
    const current = await loadVisible(req);
    if (String(current.requestedBy) !== req.user.userId) return res.status(403).json({ message: "Only the requester can delete this draft" });
    await runTransaction(async (session) => {
      const removed = await MaterialRequest.findOneAndDelete({ _id: current._id, status: "DRAFT" }, { session });
      if (!removed) throw fail(409, "Only draft requests can be deleted");
      await addAudit(removed, req, "deleted", "DRAFT", null, "", { mrNumber: removed.mrNumber }, session);
    });
    res.status(200).json({ message: "Draft deleted" });
  } catch (error) {
    sendError(res, error, "Draft could not be deleted");
  }
};

export const submitMaterialRequest = async (req, res) => {
  try {
    const current = await loadVisible(req);
    if (String(current.requestedBy) !== req.user.userId) return res.status(403).json({ message: "Only the requester can submit this request" });
    if (!current.items.length) return res.status(400).json({ message: "Add at least one item before submitting" });

    const mr = await runTransaction(async (session) => {
      const updated = await MaterialRequest.findOneAndUpdate(
        { _id: current._id, status: "DRAFT" },
        { $set: { status: "PENDING_APPROVAL", submittedAt: new Date() } },
        { returnDocument: "after", session },
      );
      if (!updated) throw fail(409, "Only draft requests can be submitted");
      await addAudit(updated, req, "submitted", "DRAFT", "PENDING_APPROVAL", "", {}, session);
      return updated;
    });
    await notifyRequestStakeholders({ mr, title: `MR ${mr.mrNumber} submitted for approval`, message: `${req.user.fullName} submitted a material request for ${mr.department}.`, link: `/material-requests/view?id=${mr._id}`, byUser: req.user.userId });
    res.status(200).json({ message: "Material request submitted for approval", materialRequest: await present(mr) });
  } catch (error) {
    sendError(res, error, "Material request could not be submitted");
  }
};

// Either an Engineering Executive or an Engineering Manager decides; the first decision wins.
// The status condition in the update makes the decision atomic, so a second approver gets 409.
const decide = async (req, res, decision) => {
  try {
    const current = await loadVisible(req);
    if (String(current.requestedBy) === req.user.userId) return res.status(403).json({ message: "You cannot approve or reject your own request" });
    const remarks = text(req.body.remarks, 1000);
    if (decision === "REJECTED" && !remarks) return res.status(400).json({ message: "A reason is required to reject a request" });
    const toStatus = decision === "APPROVED" ? "PENDING_ISSUE" : "REJECTED";

    const mr = await runTransaction(async (session) => {
      const updated = await MaterialRequest.findOneAndUpdate(
        { _id: current._id, status: "PENDING_APPROVAL", "approval.decision": null },
        { $set: { status: toStatus, approval: { decision, ...actor(req), remarks } } },
        { returnDocument: "after", session },
      );
      if (!updated) throw fail(409, "This request is no longer pending approval");
      await addAudit(updated, req, decision === "APPROVED" ? "approved" : "rejected", "PENDING_APPROVAL", toStatus, remarks, {}, session);
      return updated;
    });
    await notifyUsers({
      userIds: [String(mr.requestedBy)],
      rolePermissions: decision === "APPROVED" ? ["materialRequests.issue"] : [],
      title: `MR ${mr.mrNumber} ${decision === "APPROVED" ? "approved" : "rejected"}`,
      message: decision === "APPROVED"
        ? `${req.user.fullName} approved your material request. It is ready for issue.`
        : `${req.user.fullName} rejected your material request. ${remarks || "No reason was provided."}`,
      type: decision === "APPROVED" ? "success" : "warning",
      link: `/material-requests/view?id=${mr._id}`,
      sourceType: "MaterialRequest",
      sourceId: mr._id,
      metadata: { requestNumber: mr.mrNumber, approverRole: req.user.role },
      sendEmail: true,
    });
    res.status(200).json({ message: decision === "APPROVED" ? "Material request approved" : "Material request rejected", materialRequest: await present(mr) });
  } catch (error) {
    sendError(res, error, "Approval could not be recorded");
  }
};

export const approveMaterialRequest = (req, res) => decide(req, res, "APPROVED");
export const rejectMaterialRequest = (req, res) => decide(req, res, "REJECTED");

// Stock the Store Keeper can issue from, per outstanding line, using available (unreserved) quantities.
export const getStockAvailability = async (req, res) => {
  try {
    const mr = await loadVisible(req);
    const itemIds = mr.items.map((line) => line.item);
    const records = await Inventory.find({ item: { $in: itemIds }, quantity: { $gt: 0 } })
      .populate({ path: "bin", select: "binCode binName locationCode isActive level", populate: { path: "level", select: "levelCode rack", populate: { path: "rack", select: "rackCode zone", populate: { path: "zone", select: "zoneCode warehouse", populate: { path: "warehouse", select: "warehouseCode warehouseName" } } } } });

    const lines = mr.items.map((line) => {
      const bins = records
        .filter((record) => String(record.item) === String(line.item) && record.bin?.isActive && record.quantity - record.reservedQuantity > 0)
        .map((record) => ({
          bin: record.bin._id,
          binCode: record.bin.binCode,
          locationCode: record.bin.locationCode,
          warehouse: record.bin.level?.rack?.zone?.warehouse?.warehouseCode || "",
          path: [record.bin.level?.rack?.zone?.warehouse?.warehouseCode, record.bin.level?.rack?.zone?.zoneCode, record.bin.level?.rack?.rackCode, record.bin.level?.levelCode].filter(Boolean).join(" / "),
          availableQuantity: roundQty(record.quantity - record.reservedQuantity),
        }))
        .sort((a, b) => b.availableQuantity - a.availableQuantity);
      return {
        line: line._id,
        item: line.item,
        itemCode: line.itemCode,
        remainingQuantity: roundQty(line.requestedQuantity - line.issuedQuantity),
        totalAvailable: roundQty(bins.reduce((sum, bin) => sum + bin.availableQuantity, 0)),
        bins,
      };
    });
    res.status(200).json({ lines });
  } catch (error) {
    sendError(res, error, "Stock availability could not be loaded");
  }
};

const readAllocations = (input) => {
  if (!Array.isArray(input) || input.length === 0) throw fail(400, "Enter at least one quantity to issue");
  if (input.length > 200) throw fail(400, "Too many issue lines");
  const seen = new Set();
  return input.map((entry) => {
    if (!mongoose.isValidObjectId(entry?.line) || !mongoose.isValidObjectId(entry?.bin)) throw fail(400, "Each issue line needs a valid request line and bin");
    const quantity = Number(entry.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw fail(400, "Issue quantities must be greater than zero");
    const key = `${entry.line}:${entry.bin}`;
    if (seen.has(key)) throw fail(400, "The same bin is listed twice for one item");
    seen.add(key);
    return { line: String(entry.line), bin: String(entry.bin), quantity };
  });
};

const findPriorIssue = async (idempotencyKey, mrId) => {
  const prior = await MaterialRequestIssue.findOne({ idempotencyKey });
  if (!prior) return null;
  if (String(prior.materialRequest) !== String(mrId)) throw fail(409, "This issue key was already used for a different request");
  return prior;
};

const issueStock = async (req, res, issueType) => {
  let current;
  const idempotencyKey = text(req.body.idempotencyKey, 100);
  try {
    if (idempotencyKey.length < 8) return res.status(400).json({ message: "idempotencyKey is required (8-100 characters)" });
    current = await loadVisible(req);
    const allocations = readAllocations(req.body.allocations);
    const remarks = text(req.body.remarks, 1000);

    const prior = await findPriorIssue(idempotencyKey, current._id);
    if (prior) {
      const mr = await MaterialRequest.findById(current._id);
      return res.status(200).json({ message: "This issue was already recorded", idempotent: true, issue: prior, materialRequest: await present(mr) });
    }

    const result = await runTransaction(async (session) => {
      const mr = await MaterialRequest.findById(current._id).session(session);
      if (mr.status === "ON_HOLD") throw fail(409, "This request is on hold. Resume it before issuing");
      if (!ISSUABLE.includes(mr.status)) throw fail(409, `Stock cannot be issued for a request in status ${mr.status}`);

      const totals = new Map();
      for (const allocation of allocations) {
        const line = mr.items.id(allocation.line);
        if (!line) throw fail(400, "An issue line does not belong to this request");
        totals.set(allocation.line, roundQty((totals.get(allocation.line) || 0) + allocation.quantity));
      }
      for (const line of mr.items) {
        const remaining = roundQty(line.requestedQuantity - line.issuedQuantity);
        const total = totals.get(String(line._id)) || 0;
        if (total > remaining) throw fail(409, `${line.itemCode}: issue quantity ${total} exceeds the outstanding ${remaining}`);
        if (issueType === "full" && remaining > 0 && total !== remaining) {
          throw fail(400, `Full issue must cover the outstanding ${remaining} ${line.uom} of ${line.itemCode}`);
        }
      }

      const issueLines = [];
      for (const [index, allocation] of allocations.entries()) {
        const line = mr.items.id(allocation.line);
        const item = await Item.findById(line.item).session(session);
        if (!item?.isActive) throw fail(409, `${line.itemCode} is no longer an active item`);
        const bin = await validateBinHierarchy(allocation.bin, session);
        await touchBin(bin, allocation.quantity, "out", item, session);
        await removeStock(item._id, bin._id, allocation.quantity, session).catch((error) => {
          throw error.status === 409 ? fail(409, `Not enough available stock of ${line.itemCode} in bin ${bin.locationCode || bin.binCode}`) : error;
        });
        const [movement] = await StockMovement.create([{
          transactionReference: `${mr.mrNumber}/${idempotencyKey}/${index + 1}`,
          movementType: "issue",
          item: item._id,
          sourceBin: bin._id,
          quantity: allocation.quantity,
          remarks: `Material request ${mr.mrNumber}${mr.workOrderNumber ? `, WO ${mr.workOrderNumber}` : ""}${remarks ? ` - ${remarks}` : ""}`.slice(0, 1000),
          user: req.user.userId,
          occurredAt: new Date(),
        }], { session });
        issueLines.push({ line: line._id, item: item._id, itemCode: line.itemCode, bin: bin._id, binCode: bin.locationCode || bin.binCode, quantity: allocation.quantity, stockMovement: movement._id });
      }

      for (const line of mr.items) {
        const total = totals.get(String(line._id));
        if (total) line.issuedQuantity = roundQty(line.issuedQuantity + total);
      }
      const fromStatus = mr.status;
      const complete = mr.items.every((line) => roundQty(line.requestedQuantity - line.issuedQuantity) === 0);
      mr.status = complete ? "ISSUED" : "PARTIALLY_ISSUED";
      if (complete) mr.issuedAt = new Date();
      await mr.save({ session });

      const [issue] = await MaterialRequestIssue.create([{
        materialRequest: mr._id,
        mrNumber: mr.mrNumber,
        idempotencyKey,
        issueType,
        lines: issueLines,
        issuedBy: req.user.userId,
        issuedByName: req.user.fullName,
        remarks,
      }], { session });
      await addAudit(mr, req, issueType === "full" ? "issued_full" : "issued_partial", fromStatus, mr.status, remarks, {
        issue: String(issue._id),
        lines: issueLines.map((line) => ({ itemCode: line.itemCode, bin: line.binCode, quantity: line.quantity })),
      }, session);
      await Activity.create([{
        user: req.user.userId,
        action: "materialRequest.issue",
        entityType: "MaterialRequest",
        entityId: mr._id,
        details: { mrNumber: mr.mrNumber, issueType, lines: issueLines.length },
        ipAddress: req.ip,
      }], { session });
      return { mr, issue };
    });
    await notifyUsers({
      userIds: [String(result.mr.requestedBy)],
      title: `MR ${result.mr.mrNumber} ${result.mr.status === "ISSUED" ? "fully issued" : "partially issued"}`,
      message: `${req.user.fullName} issued ${issueType === "full" ? "all requested quantities" : "quantities from the request"} for ${result.mr.mrNumber}.`,
      type: "info",
      link: `/material-requests/view?id=${result.mr._id}`,
      sourceType: "MaterialRequest",
      sourceId: result.mr._id,
      metadata: { requestNumber: result.mr.mrNumber, issueType, eventKey: String(result.issue._id) },
      sendEmail: true,
    });
    res.status(201).json({
      message: result.mr.status === "ISSUED" ? "All items issued" : "Partial issue recorded",
      idempotent: false,
      issue: result.issue,
      materialRequest: await present(result.mr),
    });
  } catch (error) {
    if (current && idempotencyKey && (error.code === 11000 || error.codeName === "WriteConflict")) {
      const prior = await MaterialRequestIssue.findOne({ idempotencyKey, materialRequest: current._id });
      if (prior) {
        const mr = await MaterialRequest.findById(current._id);
        return res.status(200).json({ message: "This issue was already recorded", idempotent: true, issue: prior, materialRequest: await present(mr) });
      }
    }
    sendError(res, error, "Stock could not be issued");
  }
};

export const issueFull = (req, res) => issueStock(req, res, "full");
export const issuePartial = (req, res) => issueStock(req, res, "partial");

export const holdMaterialRequest = async (req, res) => {
  try {
    const current = await loadVisible(req);
    const reason = text(req.body.reason, 1000);
    if (!reason) return res.status(400).json({ message: "A hold reason is required" });

    const mr = await runTransaction(async (session) => {
      const doc = await MaterialRequest.findById(current._id).session(session);
      if (!ISSUABLE.includes(doc.status)) throw fail(409, `A request in status ${doc.status} cannot be put on hold`);
      const fromStatus = doc.status;
      doc.hold = { ...actor(req), remarks: reason, previousStatus: fromStatus };
      doc.status = "ON_HOLD";
      await doc.save({ session });
      await addAudit(doc, req, "held", fromStatus, "ON_HOLD", reason, {}, session);
      return doc;
    });
    await notifyUsers({
      userIds: [String(mr.requestedBy)],
      title: `MR ${mr.mrNumber} placed on hold`,
      message: `${req.user.fullName} placed your request on hold: ${reason}.`,
      type: "warning",
      link: `/material-requests/view?id=${mr._id}`,
      sourceType: "MaterialRequest",
      sourceId: mr._id,
      metadata: { requestNumber: mr.mrNumber, holdReason: reason, eventKey: mr.updatedAt.toISOString() },
      sendEmail: true,
    });
    res.status(200).json({ message: "Material request placed on hold", materialRequest: await present(mr) });
  } catch (error) {
    sendError(res, error, "Request could not be placed on hold");
  }
};

export const resumeMaterialRequest = async (req, res) => {
  try {
    const current = await loadVisible(req);
    const remarks = text(req.body.remarks, 1000);

    const mr = await runTransaction(async (session) => {
      const doc = await MaterialRequest.findById(current._id).session(session);
      if (doc.status !== "ON_HOLD") throw fail(409, "Only requests on hold can be resumed");
      const anyIssued = doc.items.some((line) => line.issuedQuantity > 0);
      const toStatus = ISSUABLE.includes(doc.hold.previousStatus) ? doc.hold.previousStatus : anyIssued ? "PARTIALLY_ISSUED" : "PENDING_ISSUE";
      doc.status = toStatus;
      doc.hold.previousStatus = null;
      await doc.save({ session });
      await addAudit(doc, req, "resumed", "ON_HOLD", toStatus, remarks, {}, session);
      return doc;
    });
    await notifyUsers({
      userIds: [String(mr.requestedBy)],
      title: `MR ${mr.mrNumber} resumed`,
      message: `${req.user.fullName} resumed the request and it is active again.`,
      type: "success",
      link: `/material-requests/view?id=${mr._id}`,
      sourceType: "MaterialRequest",
      sourceId: mr._id,
      metadata: { requestNumber: mr.mrNumber, eventKey: mr.updatedAt.toISOString() },
      sendEmail: true,
    });
    res.status(200).json({ message: "Material request resumed", materialRequest: await present(mr) });
  } catch (error) {
    sendError(res, error, "Request could not be resumed");
  }
};

export const getIssueHistory = async (req, res) => {
  try {
    const mr = await loadVisible(req);
    const issues = await MaterialRequestIssue.find({ materialRequest: mr._id }).sort({ issuedAt: 1 });
    res.status(200).json({ issues });
  } catch (error) {
    sendError(res, error, "Issue history could not be loaded");
  }
};

// Technicians confirm what they physically received, possibly over several partial issues.
// A line can never be confirmed beyond what was issued to it. The request becomes RECEIVED once
// everything requested was issued and every issued quantity was confirmed.
export const receiveMaterialRequest = async (req, res) => {
  try {
    const current = await loadVisible(req);
    if (String(current.requestedBy) !== req.user.userId) return res.status(403).json({ message: "Only the requester can confirm receipt" });
    if (!Array.isArray(req.body.items) || req.body.items.length === 0) return res.status(400).json({ message: "Enter the received quantity for at least one item" });
    const remarks = text(req.body.remarks, 1000);

    const mr = await runTransaction(async (session) => {
      const doc = await MaterialRequest.findById(current._id).session(session);
      if (!["PARTIALLY_ISSUED", "ON_HOLD", "ISSUED"].includes(doc.status)) throw fail(409, `Receipt cannot be confirmed for a request in status ${doc.status}`);
      const lines = [];
      const seen = new Set();
      for (const entry of req.body.items) {
        if (!mongoose.isValidObjectId(entry?.line) || seen.has(String(entry.line))) throw fail(400, "Invalid or repeated request line");
        seen.add(String(entry.line));
        const line = doc.items.id(entry.line);
        if (!line) throw fail(400, "A line does not belong to this request");
        const quantity = Number(entry.receivedQuantity);
        if (!Number.isFinite(quantity) || quantity < 0) throw fail(400, "Received quantities must be zero or more");
        if (quantity === 0) continue;
        const pending = roundQty(line.issuedQuantity - (line.receivedQuantity || 0));
        if (quantity > pending) throw fail(400, `${line.itemCode}: only ${pending} ${line.uom} issued and not yet received`);
        line.receivedQuantity = roundQty((line.receivedQuantity || 0) + quantity);
        lines.push({ line: line._id, itemCode: line.itemCode, quantity });
      }
      if (!lines.length) throw fail(400, "Enter a received quantity greater than zero");

      const fromStatus = doc.status;
      doc.receipts.push({ ...actor(req), remarks, lines });
      const complete = doc.status === "ISSUED" && doc.items.every((line) => roundQty(line.issuedQuantity - (line.receivedQuantity || 0)) === 0);
      if (complete) doc.status = "RECEIVED";
      await doc.save({ session });
      await addAudit(doc, req, "received", fromStatus, doc.status, remarks, { lines: lines.map((line) => ({ itemCode: line.itemCode, quantity: line.quantity })) }, session);
      return doc;
    });
    await notifyRequestStakeholders({ mr, title: `MR ${mr.mrNumber} receipt confirmed`, message: `${req.user.fullName} confirmed receipt of issued materials.`, link: `/material-requests/view?id=${mr._id}`, byUser: req.user.userId });
    res.status(200).json({ message: mr.status === "RECEIVED" ? "All materials received" : "Receipt recorded", materialRequest: await present(mr) });
  } catch (error) {
    sendError(res, error, "Receipt could not be confirmed");
  }
};

export const getAuditHistory = async (req, res) => {
  try {
    const mr = await loadVisible(req);
    const audit = await MaterialRequestAudit.find({ materialRequest: mr._id }).sort({ createdAt: 1, _id: 1 });
    res.status(200).json({ audit });
  } catch (error) {
    sendError(res, error, "Audit history could not be loaded");
  }
};

