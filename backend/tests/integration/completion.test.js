import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import mongoose from "mongoose";
import { SMTPServer } from "smtp-server";
import { io } from "socket.io-client";
import User from "../../models/User.js";
import RolePermission, { ensureRolePermissions, defaultRolePermissions } from "../../models/RolePermission.js";
import Bin from "../../models/Bin.js";
import StockMovement from "../../models/StockMovement.js";
import EmailDelivery from "../../models/EmailDelivery.js";
import Notification from "../../models/Notification.js";
import { createNotifications } from "../../services/notificationService.js";
import { processEmailQueue, reconcileEmails } from "../../services/emailService.js";
import { createSocketServer, getSocketServer } from "../../socket.js";

const uri = process.env.MONGODB_TEST_URI;
const skip = !uri && "MONGODB_TEST_URI is required";
process.env.JWT_SECRET = "isolated-completion-test-secret";
let server, base;
const tokens = {}, users = {}, sockets = [];
async function api(path, { as = "Super Admin", method = "GET", body } = {}) {
  const response = await fetch(`${base}/api${path}`, { method, headers: { Authorization: `Bearer ${tokens[as]}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json().catch(() => null) };
}
before(async () => {
  if (skip) return;
  if (!new URL(uri.replace(/^mongodb(\+srv)?:/, "http:")).pathname.endsWith("_test")) throw new Error("Test database must end in _test");
  await mongoose.connect(uri, { autoCreate: false, autoIndex: false }); await mongoose.connection.db.dropDatabase();
  for (const model of Object.values(mongoose.models)) { await model.createCollection(); await model.createIndexes(); }
  await ensureRolePermissions();
  const { app } = await import("../../index.js");
  server = createSocketServer(app, ["http://localhost:3000"]); server.listen(0); await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
  for (const role of Object.keys(defaultRolePermissions())) {
    const email = `${role.replaceAll(" ", "").toLowerCase()}@qa.local`;
    users[role] = await User.create({ fullName: role, email, password: "IsolatedTest123!", role });
    const login = await api("/auth/login", { method: "POST", body: { email, password: "IsolatedTest123!" } });
    assert.equal(login.status, 200); tokens[role] = login.data.token;
  }
});
after(async () => {
  if (skip) return;
  sockets.forEach((socket) => socket.disconnect());
  if (getSocketServer()) await new Promise((resolve) => getSocketServer().close(resolve));
  await mongoose.connection.db.dropDatabase(); await mongoose.disconnect();
});

test("RBAC: active sessions grant/revoke pages and actions; direct APIs deny every module", { skip }, async () => {
  const role = "Viewer";
  assert.equal((await api("/auth/me", { as: role })).data.user.permissions.inventory, true);
  const permissions = { ...defaultRolePermissions()[role], inventory: false };
  assert.equal((await api(`/permissions/roles/${role}`, { method: "PUT", body: { permissions } })).status, 200);
  assert.equal((await api("/inventory", { as: role })).status, 403);
  assert.equal((await api("/auth/me", { as: role })).data.user.permissions.inventory, false);
  permissions.inventory = true; permissions["items.write"] = true;
  assert.equal((await api(`/permissions/roles/${role}`, { method: "PUT", body: { permissions } })).status, 200);
  assert.equal((await api("/inventory", { as: role })).status, 200);
  assert.equal((await api("/items", { as: role, method: "POST", body: { itemCode: "RBAC-1", description: "Granted at runtime" } })).status, 201);
  permissions["items.write"] = false;
  await api(`/permissions/roles/${role}`, { method: "PUT", body: { permissions } });
  assert.equal((await api("/items", { as: role, method: "POST", body: { itemCode: "RBAC-2", description: "Denied" } })).status, 403);
  assert.equal((await api(`/permissions/roles/${role}`, { as: "Admin", method: "PUT", body: { permissions } })).status, 403);
  assert.equal((await api(`/permissions/roles/${role}`, { method: "PUT", body: { permissions: { inventory: "true" } } })).status, 400);
  assert.ok((await api("/permissions/audit")).data.entries.length >= 3);
  assert.ok((await RolePermission.findOne({ role }).lean()).auditLog.length >= 3);
  await RolePermission.updateOne({ role: "Supervisor" }, { $set: { permissions: {} } });
  for (const path of ["/items", "/warehouses", "/zones", "/racks", "/levels", "/bins", "/inventory", "/stock-movements", "/dashboard", "/alerts", "/reports/items.xlsx", "/material-requests", "/new-item-requests", "/notifications", "/activities", "/auth/users"]) {
    assert.equal((await api(path, { as: "Supervisor" })).status, 403, path);
  }
  await RolePermission.deleteOne({ role: "Supervisor" });
  assert.equal((await api("/items", { as: "Supervisor" })).status, 403, "missing record denies");
  await ensureRolePermissions();
});

test("RBAC: action-only revocation rejects direct writes across every workflow", { skip }, async () => {
  const permissions = Object.fromEntries(Object.keys(defaultRolePermissions().Supervisor).map((key) => [key, !key.includes(".")]));
  await RolePermission.updateOne({ role: "Supervisor" }, { $set: { permissions } });
  const id = new mongoose.Types.ObjectId().toString();
  const writes = [
    ["POST", "/items"], ["POST", "/items/import"], ["PUT", `/items/${id}`], ["DELETE", `/items/${id}`], ["POST", `/items/${id}/images`],
    ...["warehouses", "zones", "racks", "levels", "bins"].flatMap((resource) => [["POST", `/${resource}`], ["PUT", `/${resource}/${id}`], ["DELETE", `/${resource}/${id}`]]),
    ["PUT", `/racks/${id}/grid`], ["PATCH", `/bins/${id}/deactivate`], ["PATCH", `/bins/${id}/reactivate`],
    ["POST", `/inventory/${id}/reserve`], ["POST", `/inventory/${id}/release`],
    ...["receipts", "issues", "transfers", "adjustments", "returns"].map((operation) => ["POST", `/stock-movements/${operation}`]),
    ["POST", "/material-requests"], ["PUT", `/material-requests/${id}`], ["DELETE", `/material-requests/${id}`],
    ...["submit", "approve", "reject", "issue-full", "issue-partial", "hold", "resume", "receive"].map((action) => ["POST", `/material-requests/${id}/${action}`]),
    ["POST", "/new-item-requests"], ["PUT", `/new-item-requests/${id}`], ["DELETE", `/new-item-requests/${id}`], ["POST", `/new-item-requests/${id}/submit`],
    ["POST", "/auth/users"], ["PATCH", `/auth/users/${id}`], ["PATCH", `/auth/users/${id}/active`],
  ];
  for (const [method, path] of writes) assert.equal((await api(path, { as: "Supervisor", method, body: {} })).status, 403, `${method} ${path}`);
  await RolePermission.updateOne({ role: "Supervisor" }, { $set: { permissions: defaultRolePermissions().Supervisor } });
});

test("RBAC: normalized administrator roles and dynamically privileged roles cannot be assigned or edited by Admin", { skip }, async () => {
  for (const role of ["Admin", "Super Admin", "Warehouse Admin", "Supervisor", "Engineering Manager"]) {
    const response = await api("/auth/users", { as: "Admin", method: "POST", body: { fullName: "Escalation", email: "escalation@qa.local", password: "IsolatedTest123!", role } });
    assert.equal(response.status, 403, role);
  }
  const available = await api("/auth/assignable-roles", { as: "Admin" });
  assert.equal(available.status, 200);
  assert.ok(available.data.roles.includes("Viewer"));
  assert.ok(!available.data.roles.includes("Engineering Manager"));
  assert.equal((await api(`/auth/users/${users.Admin._id}`, { as: "Admin", method: "PATCH", body: { password: "ChangedPassword123!" } })).status, 403);
  assert.equal((await api(`/auth/users/${users.Viewer._id}`, { as: "Admin", method: "PATCH", body: { role: "Admin" } })).status, 403);
  const viewerPermissions = (await RolePermission.findOne({ role: "Viewer" }).lean()).permissions;
  await RolePermission.updateOne({ role: "Viewer" }, { $set: { permissions: { ...viewerPermissions, users: true, "users.write": true } } });
  assert.equal((await api("/auth/users", { as: "Viewer", method: "POST", body: { fullName: "Indirect escalation", email: "indirect@qa.local", password: "IsolatedTest123!", role: "Store Keeper" } })).status, 403, "delegation cannot exceed actor permissions");
  await RolePermission.updateOne({ role: "Viewer" }, { $set: { permissions: viewerPermissions } });
});
let rackId, binId, itemId, otherBin;
test("rack designer: configure/adopt, show mixed stock, reject occupied archive/shrink, preserve IDs/history", { skip }, async () => {
  const warehouse = (await api("/warehouses", { method: "POST", body: { warehouseCode: "QA", warehouseName: "QA" } })).data.warehouse._id;
  const zone = (await api("/zones", { method: "POST", body: { warehouse, zoneCode: "QA", zoneName: "QA" } })).data.zone._id;
  rackId = (await api("/racks", { method: "POST", body: { zone, rackCode: "QA", rackName: "QA rack" } })).data.rack._id;
  assert.equal((await api(`/racks/${rackId}/grid`, { method: "PUT", body: { rows: 0, columns: 21 } })).status, 400);
  let grid = await api(`/racks/${rackId}/grid`, { method: "PUT", body: { rows: 2, columns: 2 } });
  assert.equal(grid.status, 200, JSON.stringify(grid.data)); assert.equal(grid.data.bins.length, 4);
  binId = grid.data.bins.find((bin) => bin.gridColumn === 2)._id;
  otherBin = grid.data.bins.find((bin) => bin._id !== binId && bin.gridColumn === 1)._id;
  for (const code of ["GRID-A", "GRID-B"]) {
    const item = (await api("/items", { method: "POST", body: { itemCode: code, description: code, uom: "Pieces" } })).data.item._id;
    itemId = item;
    assert.equal((await api("/stock-movements/receipts", { method: "POST", body: { item, destinationBin: binId, quantity: 7, transactionReference: code } })).status, 201);
  }
  grid = await api(`/racks/${rackId}/grid`);
  assert.equal(grid.data.bins.find((bin) => bin._id === binId).inventory.length, 2);
  assert.equal((await api(`/bins/${binId}`, { method: "PUT", body: { binName: "Mixed bearings" } })).status, 200);
  assert.equal((await api(`/bins/${binId}`, { method: "DELETE" })).status, 409);
  assert.equal((await api(`/bins/${binId}/deactivate`, { method: "PATCH" })).status, 409);
  assert.equal((await api(`/racks/${rackId}/grid`, { method: "PUT", body: { rows: 2, columns: 1 } })).status, 409);
  assert.equal((await api(`/racks/${rackId}/grid`, { method: "PUT", body: { rows: 3, columns: 3 } })).status, 200);
  assert.equal((await Bin.findById(binId)).binName, "Mixed bearings");
  assert.equal(await StockMovement.countDocuments({ destinationBin: binId }), 2);
  assert.equal((await api(`/bins/${otherBin}`, { method: "DELETE" })).status, 200);
  assert.ok((await Bin.findById(otherBin)).archivedAt);
  assert.equal((await api(`/bins/${otherBin}/reactivate`, { method: "PATCH" })).status, 409);
  assert.equal((await api(`/racks/${rackId}/grid`, { as: "Viewer", method: "PUT", body: { rows: 2, columns: 2 } })).status, 403);
});
async function connect(as) {
  const ticket = await api("/notifications/socket-ticket", { as, method: "POST" });
  assert.equal(ticket.status, 200);
  const socket = io(base, { auth: { token: ticket.data.token }, transports: ["websocket"], reconnection: false });
  sockets.push(socket); await once(socket, "connect"); return socket;
}
test("notifications: two authenticated sessions, private rooms, invalid auth, reconnect/history and revocation", { skip, timeout: 15000 }, async () => {
  const first = await connect("Technician"), second = await connect("Engineering Executive");
  const invalid = io(base, { auth: { token: tokens.Technician }, reconnection: false }); sockets.push(invalid);
  assert.match((await once(invalid, "connect_error"))[0].message, /Unauthorized/);
  let leaked = 0; first.on("notification:new", () => leaked++);
  const received = once(second, "notification:new");
  await createNotifications({ userIds: [users["Engineering Executive"]._id], title: "Private test", message: "Executive only" });
  assert.equal((await received)[0].title, "Private test");
  await new Promise((resolve) => setTimeout(resolve, 100)); assert.equal(leaked, 0);
  const draft = await api("/material-requests", { as: "Technician", method: "POST", body: { department: "Draft notification QA", items: [{ item: itemId, requestedQuantity: 1 }] } });
  assert.equal(draft.status, 201);
  const submission = once(second, "notification:new");
  assert.equal((await api(`/material-requests/${draft.data.materialRequest._id}/submit`, { as: "Technician", method: "POST" })).status, 200);
  assert.match((await submission)[0].title, /submitted/);
  const nir = await api("/new-item-requests", { as: "Technician", method: "POST", body: { department: "Draft NIR QA", items: [{ itemName: "Proposed part", quantity: 1, unit: "Pieces" }] } });
  assert.equal(nir.status, 201);
  const review = once(second, "notification:new");
  assert.equal((await api(`/new-item-requests/${nir.data.request._id}/submit`, { as: "Technician", method: "POST" })).status, 200);
  assert.match((await review)[0].title, /awaiting review/);
  second.disconnect();
  await createNotifications({ userIds: [users["Engineering Executive"]._id], title: "Offline test", message: "Missed while disconnected" });
  await connect("Engineering Executive");
  const history = await api("/notifications", { as: "Engineering Executive" });
  assert.ok(history.data.notifications.some((entry) => entry.title === "Offline test"));
  assert.equal((await api(`/notifications/${history.data.notifications[0]._id}/read`, { as: "Technician", method: "POST" })).status, 404);
  await RolePermission.updateOne({ role: "Engineering Executive" }, { $set: { "permissions.notifications": false } });
  const count = await Notification.countDocuments({ user: users["Engineering Executive"]._id });
  await createNotifications({ userIds: [users["Engineering Executive"]._id], title: "Revoked", message: "Must not deliver" });
  assert.equal(await Notification.countDocuments({ user: users["Engineering Executive"]._id }), count);
  assert.equal((await api("/notifications/socket-ticket", { as: "Engineering Executive", method: "POST" })).status, 403);
});

test("email: real local SMTP, persistent tracking, concurrent dedupe, retries, max attempts and reconciliation", { skip, timeout: 15000 }, async () => {
  let messages = 0, refuse = true;
  const smtp = new SMTPServer({ authOptional: true, disabledCommands: ["STARTTLS"], onData(stream, session, callback) {
    stream.on("data", () => {}); stream.on("end", () => { if (refuse) callback(Object.assign(new Error("Temporary QA rejection"), { responseCode: 451 })); else { messages++; callback(); } });
  } });
  await new Promise((resolve) => smtp.listen(0, "127.0.0.1", resolve));
  process.env.SMTP_HOST = "127.0.0.1"; process.env.SMTP_PORT = String(smtp.server.address().port);
  try {
    await EmailDelivery.updateMany({ status: "queued" }, { $set: { status: "skipped", lastError: "Non-email workflow fixture" } });
    const input = { userIds: [users.Technician._id], title: "Email QA", message: "Safe local mail", sourceType: "MaterialRequest", sourceId: new mongoose.Types.ObjectId(), sendEmail: true };
    await Promise.all([createNotifications(input), createNotifications(input)]);
    assert.equal(await EmailDelivery.countDocuments({ subject: "Email QA" }), 1);
    await processEmailQueue();
    let delivery = await EmailDelivery.findOne({ subject: "Email QA" });
    assert.equal(delivery.status, "retrying"); assert.equal(delivery.attempts, 1);
    refuse = false;
    await Promise.all([processEmailQueue({ now: new Date(Date.now() + 60000) }), processEmailQueue({ now: new Date(Date.now() + 60000) })]);
    delivery = await EmailDelivery.findById(delivery._id);
    assert.equal(delivery.status, "sent"); assert.equal(delivery.attempts, 2); assert.equal(messages, 1);
    await processEmailQueue({ now: new Date(Date.now() + 3600000) }); assert.equal(messages, 1);
    const intent = await Notification.create({ user: users.Technician._id, title: "Reconcile", message: "Persisted intent", emailRequested: true });
    await reconcileEmails(); assert.ok(await EmailDelivery.exists({ notificationId: intent._id }));
    refuse = true;
    await EmailDelivery.updateOne({ notificationId: intent._id }, { $set: { maxAttempts: 2 } });
    await processEmailQueue(); await processEmailQueue({ now: new Date(Date.now() + 60000) });
    assert.equal((await EmailDelivery.findOne({ notificationId: intent._id })).status, "failed");
    assert.equal((await api("/notifications/email-deliveries", { as: "Viewer" })).status, 403);
    const warehouse = await api("/material-requests", { as: "Technician", method: "POST", body: { department: "SMTP failure QA", submit: true, items: [{ item: itemId, requestedQuantity: 1 }] } });
    assert.equal(warehouse.status, 201, "SMTP rejection must not fail the warehouse request");
    await processEmailQueue();
    assert.equal((await api(`/material-requests/${warehouse.data.materialRequest._id}`, { as: "Technician" })).data.materialRequest.status, "PENDING_APPROVAL");
    const visible = await api("/notifications/email-deliveries"); assert.equal(visible.status, 200);
    assert.ok(visible.data.deliveries.some((entry) => entry.status === "failed"));
    const interrupted = await Notification.create({ user: users.Technician._id, title: "Interrupted worker", message: "Quarantine test" });
    await EmailDelivery.create({ notificationId: interrupted._id, userId: users.Technician._id, recipientEmail: users.Technician.email, subject: "Interrupted worker", text: "QA", status: "sending", attempts: 1, leaseUntil: new Date(0) });
    await processEmailQueue();
    const quarantined = await EmailDelivery.findOne({ notificationId: interrupted._id });
    assert.equal(quarantined.status, "failed"); assert.match(quarantined.lastError, /unknown/);
  } finally { await new Promise((resolve) => smtp.close(resolve)); }
});

test("RBAC: concurrent administrator changes preserve an active Super Admin", { skip }, async () => {
  const second = await User.create({ fullName: "Second Super", email: "second-super@qa.local", password: "IsolatedTest123!", role: "Super Admin" });
  const login = await api("/auth/login", { method: "POST", body: { email: second.email, password: "IsolatedTest123!" } });
  tokens.second = login.data.token;
  const results = await Promise.all([
    api(`/auth/users/${second._id}/active`, { method: "PATCH", body: { isActive: false } }),
    api(`/auth/users/${users["Super Admin"]._id}/active`, { as: "second", method: "PATCH", body: { isActive: false } }),
  ]);
  assert.equal(results.filter((result) => result.status === 200).length, 1, JSON.stringify(results));
  assert.equal(await User.countDocuments({ role: "Super Admin", isActive: true }), 1);
});
