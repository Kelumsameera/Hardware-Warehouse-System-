// Material Request workflow test against a SEPARATE MongoDB test database.
// Uses MONGODB_TEST_URI like workflow.test.js; the database name must end with "_test".
// Run: npm run test:integration   (skipped automatically when MONGODB_TEST_URI is not set)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

const TEST_URI = process.env.MONGODB_TEST_URI;
const skip = !TEST_URI && "MONGODB_TEST_URI is not set";

process.env.JWT_SECRET ||= "integration-test-secret";
process.env.CLIENT_ORIGIN ||= "http://localhost:3000";

let server;
let baseUrl;
const tokens = {};
const ids = {};

const api = async (path, { as = "admin", method = "GET", body } = {}) => {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokens[as]}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
};

const stockIn = async (item, bin) => {
  const { data } = await api(`/inventory?item=${item}&bin=${bin}`);
  return data.inventory[0]?.quantity ?? 0;
};

const createAndSubmit = async (lines, as = "tech") => {
  const created = await api("/material-requests", { as, method: "POST", body: { department: "Engineering", workOrderNumber: "WO-77", items: lines, submit: true } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  return created.data.materialRequest;
};

const lineId = (mr, itemId) => mr.items.find((line) => String(line.item) === String(itemId))._id;

before(async () => {
  if (skip) return;
  const url = new URL(TEST_URI.replace(/^mongodb(\+srv)?:/, "http:"));
  const dbName = url.pathname.slice(1);
  if (!dbName.endsWith("_test")) throw new Error("Refusing to run: the MONGODB_TEST_URI database name must end with _test");
  url.pathname = `/${dbName.replace(/_test$/, "_mr_test")}`;
  const mrUri = url.toString().replace(/^http:/, "mongodb:");

  await mongoose.connect(mrUri);
  await mongoose.connection.db.dropDatabase();
  const User = (await import("../../models/User.js")).default;
  await User.init();
  const people = [
    ["admin", "Super Admin"], ["tech", "Technician"], ["tech2", "Technician"], ["exec", "Engineering Executive"],
    ["manager", "Engineering Manager"], ["store", "Storekeeper"], ["store2", "Storekeeper"], ["viewer", "Viewer"],
  ];
  for (const [key, role] of people) {
    const user = await User.create({ fullName: `Test ${key}`, email: `${key}@mr.test`, password: "Password12345", role });
    ids[`user_${key}`] = String(user._id);
  }

  await (await import("../../models/RolePermission.js")).ensureRolePermissions();
  const { app } = await import("../../index.js");
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  for (const [key] of people) {
    const response = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${key}@mr.test`, password: "Password12345" }) });
    tokens[key] = (await response.json()).token;
  }

  const warehouse = (await api("/warehouses", { method: "POST", body: { warehouseCode: "MRW", warehouseName: "MR Store" } })).data.warehouse;
  const zone = (await api("/zones", { method: "POST", body: { warehouse: warehouse._id, zoneCode: "Z", zoneName: "Z" } })).data.zone;
  const rack = (await api("/racks", { method: "POST", body: { zone: zone._id, rackCode: "R", rackName: "R" } })).data.rack;
  const level = (await api("/levels", { method: "POST", body: { rack: rack._id, levelCode: "L", levelName: "L", levelNumber: 1 } })).data.level;
  for (const code of ["B1", "B2", "B3"]) {
    ids[code] = (await api("/bins", { method: "POST", body: { level: level._id, binCode: code, binName: code } })).data.bin._id;
  }
  ids.itemA = (await api("/items", { method: "POST", body: { itemCode: "MR-A", description: "Item A", uom: "Pieces" } })).data.item._id;
  ids.itemB = (await api("/items", { method: "POST", body: { itemCode: "MR-B", description: "Item B", uom: "Pieces" } })).data.item._id;
  ids.itemC = (await api("/items", { method: "POST", body: { itemCode: "MR-C", description: "Item C", uom: "Pieces" } })).data.item._id;
  const receipts = [["A1", ids.itemA, ids.B1, 50], ["B1", ids.itemB, ids.B1, 15], ["B2", ids.itemB, ids.B2, 10], ["C3", ids.itemC, ids.B3, 40]];
  for (const [ref, item, bin, quantity] of receipts) {
    const result = await api("/stock-movements/receipts", { method: "POST", body: { transactionReference: `SEED-${ref}`, item, destinationBin: bin, quantity } });
    assert.equal(result.status, 201, JSON.stringify(result.data));
  }
});

after(async () => {
  if (skip) return;
  server?.close();
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

test("1. technician creates a draft, edits it, and submits it; item details come from the item master", { skip }, async () => {
  const draft = await api("/material-requests", { as: "tech", method: "POST", body: { department: "Engineering", workOrderNumber: "WO-1", items: [{ item: ids.itemA, requestedQuantity: 5, description: "FAKE", itemCode: "FAKE" }] } });
  assert.equal(draft.status, 201);
  const mr = draft.data.materialRequest;
  assert.equal(mr.status, "DRAFT");
  assert.match(mr.mrNumber, /^MR-\d{4}-\d{6}$/);
  assert.equal(mr.items[0].itemCode, "MR-A");
  assert.equal(mr.items[0].description, "Item A");

  assert.equal((await api("/material-requests", { as: "tech", method: "POST", body: { department: "Eng", items: [{ item: ids.itemA, requestedQuantity: 0 }] } })).status, 400);
  assert.equal((await api(`/material-requests/${mr._id}`, { as: "tech2", method: "PUT", body: { remarks: "x" } })).status, 404);
  assert.equal((await api(`/material-requests/${mr._id}`, { as: "exec" })).status, 404, "drafts are private to the requester");

  const edited = await api(`/material-requests/${mr._id}`, { as: "tech", method: "PUT", body: { items: [{ item: ids.itemA, requestedQuantity: 10 }] } });
  assert.equal(edited.data.materialRequest.items[0].requestedQuantity, 10);
  const submitted = await api(`/material-requests/${mr._id}/submit`, { as: "tech", method: "POST" });
  assert.equal(submitted.data.materialRequest.status, "PENDING_APPROVAL");
  assert.equal((await api(`/material-requests/${mr._id}`, { as: "tech", method: "PUT", body: { remarks: "late" } })).status, 409);
  ids.mrA = mr._id;
});

test("2-6. either approver decides once; duplicates and unauthorized approvals are rejected", { skip }, async () => {
  assert.equal((await api(`/material-requests/${ids.mrA}/approve`, { as: "tech", method: "POST" })).status, 403);
  assert.equal((await api(`/material-requests/${ids.mrA}/approve`, { as: "store", method: "POST" })).status, 403);
  assert.equal((await api(`/material-requests/${ids.mrA}/approve`, { as: "admin", method: "POST" })).status, 403);
  assert.equal((await api(`/material-requests/${ids.mrA}/issue-full`, { as: "store", method: "POST", body: { idempotencyKey: "early-issue-1", allocations: [] } })).status, 400);

  const pending = await api("/material-requests/approvals", { as: "exec" });
  assert.ok(pending.data.requests.some((request) => request._id === ids.mrA));

  const byExec = await api(`/material-requests/${ids.mrA}/approve`, { as: "exec", method: "POST", body: { remarks: "OK for WO-1" } });
  assert.equal(byExec.status, 200);
  assert.equal(byExec.data.materialRequest.status, "PENDING_ISSUE");
  assert.equal(byExec.data.materialRequest.approval.role, "Engineering Executive");
  assert.equal(byExec.data.materialRequest.approval.name, "Test exec");

  const duplicate = await api(`/material-requests/${ids.mrA}/approve`, { as: "manager", method: "POST" });
  assert.equal(duplicate.status, 409);
  assert.equal((await api(`/material-requests/${ids.mrA}/reject`, { as: "manager", method: "POST", body: { remarks: "no" } })).status, 409);

  const mrB = await createAndSubmit([{ item: ids.itemB, requestedQuantity: 20 }]);
  const byManager = await api(`/material-requests/${mrB._id}/approve`, { as: "manager", method: "POST" });
  assert.equal(byManager.data.materialRequest.status, "PENDING_ISSUE");
  assert.equal(byManager.data.materialRequest.approval.role, "Engineering Manager");
  ids.mrB = mrB._id;

  const race = await createAndSubmit([{ item: ids.itemA, requestedQuantity: 1 }]);
  const results = await Promise.all([
    api(`/material-requests/${race._id}/approve`, { as: "exec", method: "POST" }),
    api(`/material-requests/${race._id}/reject`, { as: "manager", method: "POST", body: { remarks: "conflict" } }),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);

  // An approver cannot decide their own request.
  const own = await createAndSubmit([{ item: ids.itemA, requestedQuantity: 1 }], "tech2");
  await api(`/auth/users/${ids.user_tech2}`, { method: "PATCH", body: { role: "Engineering Manager" } });
  assert.equal((await api(`/material-requests/${own._id}/approve`, { as: "tech2", method: "POST" })).status, 403);
  await api(`/auth/users/${ids.user_tech2}`, { method: "PATCH", body: { role: "Technician" } });
});

test("7. a rejected request never reaches the store", { skip }, async () => {
  const mr = await createAndSubmit([{ item: ids.itemA, requestedQuantity: 2 }]);
  assert.equal((await api(`/material-requests/${mr._id}/reject`, { as: "exec", method: "POST" })).status, 400, "reason required");
  const rejected = await api(`/material-requests/${mr._id}/reject`, { as: "exec", method: "POST", body: { remarks: "Wrong work order" } });
  assert.equal(rejected.data.materialRequest.status, "REJECTED");
  const queue = await api("/material-requests/issue-queue?limit=100", { as: "store" });
  assert.ok(!queue.data.requests.some((request) => request._id === mr._id));
  const before = await stockIn(ids.itemA, ids.B1);
  const issue = await api(`/material-requests/${mr._id}/issue-full`, { as: "store", method: "POST", body: { idempotencyKey: "rejected-issue-1", allocations: [{ line: mr.items[0]._id, bin: ids.B1, quantity: 2 }] } });
  assert.equal(issue.status, 409);
  assert.equal(await stockIn(ids.itemA, ids.B1), before);
});

test("8. full issue deducts the correct stock and creates stock movements", { skip }, async () => {
  const mr = (await api(`/material-requests/${ids.mrA}`, { as: "store" })).data.materialRequest;
  const line = mr.items[0]._id;
  const incomplete = await api(`/material-requests/${ids.mrA}/issue-full`, { as: "store", method: "POST", body: { idempotencyKey: "full-a-short", allocations: [{ line, bin: ids.B1, quantity: 4 }] } });
  assert.equal(incomplete.status, 400, "full issue must cover the outstanding quantity");

  const availability = await api(`/material-requests/${ids.mrA}/stock`, { as: "store" });
  assert.equal(availability.data.lines[0].totalAvailable, 50);

  const before = await stockIn(ids.itemA, ids.B1);
  const issued = await api(`/material-requests/${ids.mrA}/issue-full`, { as: "store", method: "POST", body: { idempotencyKey: "full-a-0001", allocations: [{ line, bin: ids.B1, quantity: 10 }], remarks: "Handed to tech" } });
  assert.equal(issued.status, 201, JSON.stringify(issued.data));
  assert.equal(issued.data.materialRequest.status, "ISSUED");
  assert.equal(issued.data.materialRequest.items[0].remainingQuantity, 0);
  assert.equal(await stockIn(ids.itemA, ids.B1), before - 10);
  const movements = await api(`/stock-movements?item=${ids.itemA}&movementType=issue`);
  assert.ok(movements.data.movements.some((movement) => movement.transactionReference.includes("full-a-0001") && movement.quantity === 10));
});

test("9-11. partial issue, hold, resume, and issuing the rest from several bins", { skip }, async () => {
  const mr = (await api(`/material-requests/${ids.mrB}`, { as: "store" })).data.materialRequest;
  const line = mr.items[0]._id;
  const b1Before = await stockIn(ids.itemB, ids.B1);

  const partial = await api(`/material-requests/${ids.mrB}/issue-partial`, { as: "store", method: "POST", body: { idempotencyKey: "partial-b-01", allocations: [{ line, bin: ids.B1, quantity: 8 }] } });
  assert.equal(partial.status, 201);
  assert.equal(partial.data.materialRequest.status, "PARTIALLY_ISSUED");
  assert.equal(partial.data.materialRequest.items[0].remainingQuantity, 12);
  assert.equal(await stockIn(ids.itemB, ids.B1), b1Before - 8);

  const tooMuch = await api(`/material-requests/${ids.mrB}/issue-partial`, { as: "store", method: "POST", body: { idempotencyKey: "partial-b-02", allocations: [{ line, bin: ids.B1, quantity: 13 }] } });
  assert.equal(tooMuch.status, 409);

  assert.equal((await api(`/material-requests/${ids.mrB}/hold`, { as: "store", method: "POST", body: {} })).status, 400, "hold reason required");
  const held = await api(`/material-requests/${ids.mrB}/hold`, { as: "store", method: "POST", body: { reason: "Waiting for supervisor check" } });
  assert.equal(held.data.materialRequest.status, "ON_HOLD");
  assert.equal(held.data.materialRequest.hold.name, "Test store");
  assert.equal(await stockIn(ids.itemB, ids.B1), b1Before - 8, "hold does not change stock");
  const whileHeld = await api(`/material-requests/${ids.mrB}/issue-partial`, { as: "store", method: "POST", body: { idempotencyKey: "partial-b-03", allocations: [{ line, bin: ids.B1, quantity: 1 }] } });
  assert.equal(whileHeld.status, 409);

  const resumed = await api(`/material-requests/${ids.mrB}/resume`, { as: "store2", method: "POST", body: { remarks: "Checked" } });
  assert.equal(resumed.data.materialRequest.status, "PARTIALLY_ISSUED");
  assert.equal(resumed.data.materialRequest.items[0].issuedQuantity, 8);
  assert.equal((await api(`/material-requests/${ids.mrB}/issues`, { as: "store" })).data.issues.length, 1);

  const rest = await api(`/material-requests/${ids.mrB}/issue-full`, { as: "store2", method: "POST", body: { idempotencyKey: "full-b-rest", allocations: [{ line, bin: ids.B1, quantity: 7 }, { line, bin: ids.B2, quantity: 5 }] } });
  assert.equal(rest.status, 201, JSON.stringify(rest.data));
  assert.equal(rest.data.materialRequest.status, "ISSUED");
  assert.equal(await stockIn(ids.itemB, ids.B1), 0);
  assert.equal(await stockIn(ids.itemB, ids.B2), 5);
  const history = (await api(`/material-requests/${ids.mrB}/issues`, { as: "tech" })).data.issues;
  assert.equal(history.length, 2);
  assert.equal(history[1].lines.length, 2);
});

test("12. concurrent issues cannot overdraw stock", { skip }, async () => {
  const first = await createAndSubmit([{ item: ids.itemC, requestedQuantity: 30 }]);
  const second = await createAndSubmit([{ item: ids.itemC, requestedQuantity: 30 }]);
  await api(`/material-requests/${first._id}/approve`, { as: "exec", method: "POST" });
  await api(`/material-requests/${second._id}/approve`, { as: "manager", method: "POST" });

  const results = await Promise.all([
    api(`/material-requests/${first._id}/issue-full`, { as: "store", method: "POST", body: { idempotencyKey: "race-c-first", allocations: [{ line: first.items[0]._id, bin: ids.B3, quantity: 30 }] } }),
    api(`/material-requests/${second._id}/issue-full`, { as: "store2", method: "POST", body: { idempotencyKey: "race-c-second", allocations: [{ line: second.items[0]._id, bin: ids.B3, quantity: 30 }] } }),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  assert.equal(await stockIn(ids.itemC, ids.B3), 10);

  // Two store keepers issuing on the same request cannot exceed its outstanding quantity.
  const shared = await createAndSubmit([{ item: ids.itemA, requestedQuantity: 6 }]);
  await api(`/material-requests/${shared._id}/approve`, { as: "exec", method: "POST" });
  const before = await stockIn(ids.itemA, ids.B1);
  const sameRequest = await Promise.all([
    api(`/material-requests/${shared._id}/issue-partial`, { as: "store", method: "POST", body: { idempotencyKey: "race-shared-1", allocations: [{ line: shared.items[0]._id, bin: ids.B1, quantity: 4 }] } }),
    api(`/material-requests/${shared._id}/issue-partial`, { as: "store2", method: "POST", body: { idempotencyKey: "race-shared-2", allocations: [{ line: shared.items[0]._id, bin: ids.B1, quantity: 4 }] } }),
  ]);
  assert.deepEqual(sameRequest.map((result) => result.status).sort(), [201, 409]);
  const final = (await api(`/material-requests/${shared._id}`, { as: "store" })).data.materialRequest;
  assert.equal(final.items[0].issuedQuantity, 4);
  assert.equal(await stockIn(ids.itemA, ids.B1), before - 4);
  ids.mrShared = shared._id;
});

test("13. repeating an issue with the same key never deducts twice", { skip }, async () => {
  const mr = (await api(`/material-requests/${ids.mrShared}`, { as: "store" })).data.materialRequest;
  const body = { idempotencyKey: "dup-key-0001", allocations: [{ line: mr.items[0]._id, bin: ids.B1, quantity: 1 }] };
  const before = await stockIn(ids.itemA, ids.B1);
  const parallel = await Promise.all([
    api(`/material-requests/${ids.mrShared}/issue-partial`, { as: "store", method: "POST", body }),
    api(`/material-requests/${ids.mrShared}/issue-partial`, { as: "store", method: "POST", body }),
  ]);
  assert.deepEqual(parallel.map((result) => result.status).sort(), [200, 201]);
  const replay = await api(`/material-requests/${ids.mrShared}/issue-partial`, { as: "store", method: "POST", body });
  assert.equal(replay.status, 200);
  assert.equal(replay.data.idempotent, true);
  assert.equal(await stockIn(ids.itemA, ids.B1), before - 1);
  assert.equal(replay.data.materialRequest.items[0].issuedQuantity, 5);
  const other = await createAndSubmit([{ item: ids.itemA, requestedQuantity: 1 }]);
  await api(`/material-requests/${other._id}/approve`, { as: "exec", method: "POST" });
  const reused = await api(`/material-requests/${other._id}/issue-partial`, { as: "store", method: "POST", body: { ...body, allocations: [{ line: other.items[0]._id, bin: ids.B1, quantity: 1 }] } });
  assert.equal(reused.status, 409, "a key cannot be reused for another request");
});

test("14. receipts are confirmed per partial issue and never exceed what was issued", { skip }, async () => {
  const mr = (await api(`/material-requests/${ids.mrA}`, { as: "tech" })).data.materialRequest;
  const line = mr.items[0]._id;
  assert.equal((await api(`/material-requests/${ids.mrA}/receive`, { as: "store", method: "POST", body: { items: [{ line, receivedQuantity: 10 }] } })).status, 403);
  assert.equal((await api(`/material-requests/${ids.mrA}/receive`, { as: "tech", method: "POST", body: { items: [{ line, receivedQuantity: 11 }] } })).status, 400);

  // Partially issued request: 5 of 6 issued so far, so up to 5 can be confirmed.
  const shared = (await api(`/material-requests/${ids.mrShared}`, { as: "tech" })).data.materialRequest;
  const sharedLine = shared.items[0]._id;
  const firstPart = await api(`/material-requests/${ids.mrShared}/receive`, { as: "tech", method: "POST", body: { items: [{ line: sharedLine, receivedQuantity: 3 }] } });
  assert.equal(firstPart.status, 200);
  assert.equal(firstPart.data.materialRequest.status, "PARTIALLY_ISSUED");
  assert.equal(firstPart.data.materialRequest.items[0].receivedQuantity, 3);
  assert.equal(firstPart.data.materialRequest.items[0].pendingReceiptQuantity, 2);
  assert.equal((await api(`/material-requests/${ids.mrShared}/receive`, { as: "tech", method: "POST", body: { items: [{ line: sharedLine, receivedQuantity: 3 }] } })).status, 400, "only 2 issued and not yet received");

  const partA = await api(`/material-requests/${ids.mrA}/receive`, { as: "tech", method: "POST", body: { items: [{ line, receivedQuantity: 6 }], remarks: "First box" } });
  assert.equal(partA.data.materialRequest.status, "ISSUED", "not all issued quantity confirmed yet");
  const rest = await api(`/material-requests/${ids.mrA}/receive`, { as: "tech", method: "POST", body: { items: [{ line, receivedQuantity: 4 }], remarks: "Second box" } });
  assert.equal(rest.status, 200);
  assert.equal(rest.data.materialRequest.status, "RECEIVED");
  assert.equal(rest.data.materialRequest.items[0].receivedQuantity, 10);
  assert.equal(rest.data.materialRequest.receipts.length, 2);
  assert.equal(rest.data.materialRequest.receipts[1].name, "Test tech");
  assert.equal((await api(`/material-requests/${ids.mrA}/receive`, { as: "tech", method: "POST", body: { items: [{ line, receivedQuantity: 1 }] } })).status, 409);
});

test("15. audit history keeps every important action in order", { skip }, async () => {
  const auditA = (await api(`/material-requests/${ids.mrA}/audit`, { as: "admin" })).data.audit;
  assert.deepEqual(auditA.map((entry) => entry.action), ["created", "updated", "submitted", "approved", "issued_full", "received", "received"]);
  assert.equal(auditA[3].role, "Engineering Executive");
  const auditB = (await api(`/material-requests/${ids.mrB}/audit`, { as: "admin" })).data.audit;
  assert.deepEqual(auditB.map((entry) => entry.action), ["created", "submitted", "approved", "issued_partial", "held", "resumed", "issued_full"]);
  assert.equal(auditB[4].remarks, "Waiting for supervisor check");

  const mine = await api("/material-requests?limit=100", { as: "tech2" });
  assert.ok(mine.data.requests.every((request) => request.requestedByName === "Test tech2"), "technicians only see their own requests");
  assert.equal((await api("/material-requests", { as: "viewer", method: "POST", body: { department: "X", items: [{ item: ids.itemA, requestedQuantity: 1 }] } })).status, 403);
});

test("availability: search, stock status, missing items, images, and no stock changes for technicians", { skip }, async () => {
  await api("/items", { method: "POST", body: { itemCode: "MR-ZERO", description: "Never stocked gasket", uom: "Pieces" } });
  const low = await api("/items", { method: "POST", body: { itemCode: "MR-LOW", description: "Low stock fuse", uom: "Pieces", minStock: 10, reorderLevel: 20 } });
  await api("/stock-movements/receipts", { method: "POST", body: { transactionReference: "SEED-LOW", item: low.data.item._id, destinationBin: ids.B3, quantity: 5 } });

  const found = await api("/items/availability?search=MR-A", { as: "tech" });
  assert.equal(found.status, 200);
  const itemA = found.data.items.find((item) => item.itemCode === "MR-A");
  assert.equal(itemA.availableQuantity, await stockIn(ids.itemA, ids.B1));
  assert.equal(itemA.stockStatus, "IN_STOCK");
  assert.equal((await api("/items/availability?search=MR-ZERO", { as: "tech" })).data.items[0].stockStatus, "OUT_OF_STOCK");
  assert.equal((await api("/items/availability?search=MR-LOW", { as: "tech" })).data.items[0].stockStatus, "LOW_STOCK");
  const missing = await api("/items/availability?search=NO-SUCH-PART", { as: "tech" });
  assert.equal(missing.data.total, 0, "a part that is not in the Item master returns no rows, unlike an out-of-stock item");

  const detail = await api(`/items/${ids.itemA}/availability`, { as: "tech" });
  assert.equal(detail.data.warehouses[0].warehouseCode, "MRW");
  assert.ok("image" in detail.data.item);

  const reserve = await api("/inventory?item=" + ids.itemA, { as: "tech" });
  assert.equal(reserve.status, 200);
  assert.equal((await api(`/inventory/${reserve.data.inventory[0]._id}/reserve`, { as: "tech", method: "POST", body: { quantity: 1 } })).status, 403);
  assert.equal((await api("/stock-movements/issues", { as: "tech", method: "POST", body: { transactionReference: "TECH-1", item: ids.itemA, sourceBin: ids.B1, quantity: 1 } })).status, 403);
  assert.equal((await api(`/items/${ids.itemA}`, { as: "tech", method: "PUT", body: { minStock: 1 } })).status, 403);
});

test("draft delete, item images on lines, multiple partial issues, and document access", { skip }, async () => {
  const draft = await api("/material-requests", { as: "tech", method: "POST", body: { department: "Eng", items: [{ item: ids.itemA, requestedQuantity: 1 }] } });
  assert.ok("image" in draft.data.materialRequest.items[0]);
  assert.equal((await api(`/material-requests/${draft.data.materialRequest._id}`, { as: "tech2", method: "DELETE" })).status, 404, "another technician cannot even see the draft");
  assert.equal((await api(`/material-requests/${draft.data.materialRequest._id}`, { as: "tech", method: "DELETE" })).status, 200);
  assert.equal((await api(`/material-requests/${draft.data.materialRequest._id}`, { as: "tech" })).status, 404);
  assert.equal((await api(`/material-requests/${ids.mrB}`, { as: "tech", method: "DELETE" })).status, 409, "submitted requests cannot be deleted");

  const multi = await createAndSubmit([{ item: ids.itemA, requestedQuantity: 9 }]);
  await api(`/material-requests/${multi._id}/approve`, { as: "manager", method: "POST" });
  const line = multi.items[0]._id;
  for (const [key, quantity] of [["multi-1", 2], ["multi-2", 3], ["multi-3", 4]]) {
    const result = await api(`/material-requests/${multi._id}/issue-partial`.replace("partial", quantity === 4 ? "full" : "partial"), { as: "store", method: "POST", body: { idempotencyKey: `${key}-xyz`, allocations: [{ line, bin: ids.B1, quantity }] } });
    assert.equal(result.status, 201, JSON.stringify(result.data));
  }
  const after = (await api(`/material-requests/${multi._id}`, { as: "store" })).data.materialRequest;
  assert.equal(after.status, "ISSUED");
  assert.equal((await api(`/material-requests/${multi._id}/issues`, { as: "store" })).data.issues.length, 3);

  const queue = await api("/material-requests/issue-queue?status=ISSUED&limit=100", { as: "store" });
  assert.ok(queue.data.requests.some((request) => request._id === multi._id));
  const activeQueue = await api("/material-requests/issue-queue?limit=100", { as: "store" });
  assert.ok(!activeQueue.data.requests.some((request) => request._id === multi._id), "issued requests leave the default queue");

  const before = after.updatedAt;
  await api(`/material-requests/${multi._id}`, { as: "exec" });
  await api(`/material-requests/${multi._id}/audit`, { as: "exec" });
  assert.equal((await api(`/material-requests/${multi._id}`, { as: "store" })).data.materialRequest.updatedAt, before, "viewing / printing changes nothing");
  assert.equal((await api(`/material-requests/${multi._id}`, { as: "tech2" })).status, 404, "another technician cannot open the document");
});
