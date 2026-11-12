// End-to-end API workflow test against a SEPARATE MongoDB test database.
//
// Requirements:
//   - MONGODB_TEST_URI points to a replica-set MongoDB (transactions are required),
//     e.g. mongodb://127.0.0.1:27017/engineering_wms_test?replicaSet=rs0
//   - The database name must end with "_test". The test drops ONLY that database.
//
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
let adminToken;
let viewerToken;
const ids = {};

const api = async (path, { token = adminToken, method = "GET", body } = {}) => {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
};

before(async () => {
  if (skip) return;
  const dbName = new URL(TEST_URI.replace(/^mongodb(\+srv)?:/, "http:")).pathname.slice(1);
  if (!dbName.endsWith("_test")) throw new Error("Refusing to run: the MONGODB_TEST_URI database name must end with _test");

  await mongoose.connect(TEST_URI);
  await mongoose.connection.db.dropDatabase();
  const User = (await import("../../models/User.js")).default;
  await User.init();
  await User.create({ fullName: "Test Admin", email: "admin@test.local", password: "AdminPassword123", role: "Super Admin" });

  await (await import("../../models/RolePermission.js")).ensureRolePermissions();
  const { app } = await import("../../index.js");
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (skip) return;
  server?.close();
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

test("login, profile, and user management", { skip }, async () => {
  const bad = await api("/auth/login", { token: null, method: "POST", body: { email: "admin@test.local", password: "wrong-password" } });
  assert.equal(bad.status, 401);

  const login = await api("/auth/login", { token: null, method: "POST", body: { email: "admin@test.local", password: "AdminPassword123" } });
  assert.equal(login.status, 200);
  adminToken = login.data.token;

  const me = await api("/auth/me");
  assert.equal(me.data.user.role, "Super Admin");

  const created = await api("/auth/users", { method: "POST", body: { fullName: "View Only", email: "viewer@test.local", password: "ViewerPassword1", role: "Viewer" } });
  assert.equal(created.status, 201);
  ids.viewer = created.data.user.id;

  const viewerLogin = await api("/auth/login", { token: null, method: "POST", body: { email: "viewer@test.local", password: "ViewerPassword1" } });
  viewerToken = viewerLogin.data.token;

  const ownRole = await api(`/auth/users/${me.data.user.id}`, { method: "PATCH", body: { role: "Viewer" } });
  assert.equal(ownRole.status, 400);
});

test("location hierarchy and item master", { skip }, async () => {
  const warehouse = await api("/warehouses", { method: "POST", body: { warehouseCode: "WH1", warehouseName: "Main" } });
  assert.equal(warehouse.status, 201);
  ids.warehouse = warehouse.data.warehouse._id;
  const zone = await api("/zones", { method: "POST", body: { warehouse: ids.warehouse, zoneCode: "Z1", zoneName: "Zone 1" } });
  ids.zone = zone.data.zone._id;
  const rack = await api("/racks", { method: "POST", body: { zone: ids.zone, rackCode: "R1", rackName: "Rack 1" } });
  ids.rack = rack.data.rack._id;
  const level = await api("/levels", { method: "POST", body: { rack: ids.rack, levelCode: "L1", levelName: "Level 1", levelNumber: 1 } });
  ids.level = level.data.level._id;
  const binA = await api("/bins", { method: "POST", body: { level: ids.level, binCode: "B1", binName: "Bin 1", capacity: 100, capacityUnit: "Pieces" } });
  const binB = await api("/bins", { method: "POST", body: { level: ids.level, binCode: "B2", binName: "Bin 2" } });
  assert.equal(binA.status, 201);
  ids.binA = binA.data.bin._id;
  ids.binB = binB.data.bin._id;

  const viewerWrite = await api("/warehouses", { token: viewerToken, method: "POST", body: { warehouseCode: "X", warehouseName: "X" } });
  assert.equal(viewerWrite.status, 403);

  const invalidLevels = await api("/items", { method: "POST", body: { itemCode: "BAD", description: "Bad", minStock: 50, maxStock: 10 } });
  assert.equal(invalidLevels.status, 400);

  const item = await api("/items", { method: "POST", body: { itemCode: "ITEM-1", description: "Bearing", uom: "Pieces", minStock: 10, reorderLevel: 20 } });
  assert.equal(item.status, 201);
  ids.item = item.data.item._id;
  const duplicate = await api("/items", { method: "POST", body: { itemCode: "ITEM-1", description: "Duplicate" } });
  assert.equal(duplicate.status, 409);
});

test("stock movements keep inventory and bin capacity consistent", { skip }, async () => {
  const receipt = await api("/stock-movements/receipts", { method: "POST", body: { transactionReference: "RCPT-1", item: ids.item, destinationBin: ids.binA, quantity: 60 } });
  assert.equal(receipt.status, 201, JSON.stringify(receipt.data));

  const replay = await api("/stock-movements/receipts", { method: "POST", body: { transactionReference: "RCPT-1", item: ids.item, destinationBin: ids.binA, quantity: 60 } });
  assert.equal(replay.status, 200);
  assert.equal(replay.data.idempotent, true);

  const overCapacity = await api("/stock-movements/receipts", { method: "POST", body: { transactionReference: "RCPT-2", item: ids.item, destinationBin: ids.binA, quantity: 50 } });
  assert.equal(overCapacity.status, 409);

  const overIssue = await api("/stock-movements/issues", { method: "POST", body: { transactionReference: "ISS-1", item: ids.item, sourceBin: ids.binA, quantity: 61 } });
  assert.equal(overIssue.status, 409);

  const transfer = await api("/stock-movements/transfers", { method: "POST", body: { transactionReference: "TRF-1", item: ids.item, sourceBin: ids.binA, destinationBin: ids.binB, quantity: 15 } });
  assert.equal(transfer.status, 201);

  const issue = await api("/stock-movements/issues", { method: "POST", body: { transactionReference: "ISS-2", item: ids.item, sourceBin: ids.binB, quantity: 5 } });
  assert.equal(issue.status, 201);

  const viewerIssue = await api("/stock-movements/issues", { token: viewerToken, method: "POST", body: { transactionReference: "ISS-3", item: ids.item, sourceBin: ids.binB, quantity: 1 } });
  assert.equal(viewerIssue.status, 403);

  const inventory = await api(`/inventory?item=${ids.item}`);
  const byBin = Object.fromEntries(inventory.data.inventory.map((record) => [record.bin._id, record.quantity]));
  assert.equal(byBin[ids.binA], 45);
  assert.equal(byBin[ids.binB], 10);

  const bin = await api(`/bins/${ids.binA}`);
  assert.equal(bin.data.availableCapacity, 55);

  const deactivate = await api(`/warehouses/${ids.warehouse}`, { method: "DELETE" });
  assert.equal(deactivate.status, 409);
});

test("dashboard, alerts, and reports reflect real records", { skip }, async () => {
  const dashboard = await api("/dashboard");
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.data.counts.totalItems, 1);
  assert.equal(dashboard.data.stock.quantity, 55);
  assert.equal(dashboard.data.movementSeries.length, 14);

  const viewerDashboard = await api("/dashboard", { token: viewerToken });
  assert.equal(viewerDashboard.data.recentMovements, null);

  const alerts = await api("/alerts?type=low-stock");
  assert.equal(alerts.data.alertCount, 0);

  const movements = await api(`/stock-movements?warehouse=${ids.warehouse}`);
  assert.equal(movements.data.total, 3);

  const report = await fetch(`${baseUrl}/api/reports/movements.xlsx?movementType=receipt`, { headers: { Authorization: `Bearer ${adminToken}` } });
  assert.equal(report.status, 200);
  assert.match(report.headers.get("content-type"), /spreadsheetml/);

  const activities = await api("/activities?limit=100");
  assert.ok(activities.data.activities.some((activity) => activity.action === "item.create"));
  assert.ok(activities.data.activities.some((activity) => activity.action === "stock.transfer"));
});
