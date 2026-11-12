// New / non-stock item request workflow. Uses MONGODB_TEST_URI (database name must end with "_test").
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

const api = async (path, { as = "admin", method = "GET", body, form } = {}) => {
  const headers = { Authorization: `Bearer ${tokens[as]}` };
  if (!form) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}/api${path}`, { method, headers, body: form || (body === undefined ? undefined : JSON.stringify(body)) });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
};

const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8cfc000000301010018dd8db40000000049454e44ae426082", "hex");

before(async () => {
  if (skip) return;
  const url = new URL(TEST_URI.replace(/^mongodb(\+srv)?:/, "http:"));
  const dbName = url.pathname.slice(1);
  if (!dbName.endsWith("_test")) throw new Error("Refusing to run: the MONGODB_TEST_URI database name must end with _test");
  url.pathname = `/${dbName.replace(/_test$/, "_nir_test")}`;
  await mongoose.connect(url.toString().replace(/^http:/, "mongodb:"));
  await mongoose.connection.db.dropDatabase();
  const User = (await import("../../models/User.js")).default;
  await User.init();
  const people = [["admin", "Super Admin"], ["tech", "Technician"], ["tech2", "Technician"], ["exec", "Engineering Executive"], ["manager", "Engineering Manager"], ["store", "Storekeeper"]];
  for (const [key, role] of people) await User.create({ fullName: `Test ${key}`, email: `${key}@nir.test`, password: "Password12345", role });
  await (await import("../../models/RolePermission.js")).ensureRolePermissions();
  const { app } = await import("../../index.js");
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  for (const [key] of people) {
    const response = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${key}@nir.test`, password: "Password12345" }) });
    tokens[key] = (await response.json()).token;
  }
  await api("/items", { method: "POST", body: { itemCode: "PMP-SEAL-40", description: "Mechanical seal 40mm for centrifugal pump", uom: "Pieces" } });
});

after(async () => {
  if (skip) return;
  server?.close();
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

test("28-33. new item request: draft, image, duplicates, submit to executive, read-only, no stock or procurement effects", { skip }, async () => {
  const counts = async () => Promise.all(["items", "inventories", "stockmovements"].map((name) => mongoose.connection.db.collection(name).countDocuments()));
  const before = await counts();

  const similar = await api("/new-item-requests/similar-items?q=pump seal 40mm", { as: "tech" });
  assert.equal(similar.data.items[0].itemCode, "PMP-SEAL-40", "possible duplicate shown before submitting");

  const draft = await api("/new-item-requests", { as: "tech", method: "POST", body: {
    department: "Engineering", projectName: "Line 3 upgrade", workOrderNumber: "WO-900", priority: "High",
    items: [{ itemName: "Servo motor 1kW", description: "AC servo", specification: "230V, 3000rpm", quantity: 2, unit: "Pieces" }],
  } });
  assert.equal(draft.status, 201);
  const request = draft.data.request;
  assert.equal(request.status, "DRAFT");
  assert.match(request.requestNumber, /^NIR-\d{4}-\d{6}$/);
  assert.equal((await api(`/new-item-requests/${request._id}/submit`, { as: "tech", method: "POST" })).status, 400, "justification required");

  const form = new FormData();
  form.append("image", new Blob([png], { type: "image/png" }), "ref.png");
  const uploaded = await api(`/new-item-requests/${request._id}/items/${request.items[0]._id}/image`, { as: "tech", method: "POST", form });
  assert.equal(uploaded.status, 201);
  assert.match(uploaded.data.request.items[0].referenceImage, /^\/uploads\/new-items\//);

  const edited = await api(`/new-item-requests/${request._id}`, { as: "tech", method: "PUT", body: {
    justification: "Replacing obsolete drive",
    items: [{ ...uploaded.data.request.items[0], quantity: 3 }, { itemName: "Coupling", quantity: 2, unit: "Pieces" }],
  } });
  assert.equal(edited.data.request.items[0].quantity, 3);
  assert.equal(edited.data.request.items[0].referenceImage, uploaded.data.request.items[0].referenceImage, "image kept when editing");

  assert.equal((await api(`/new-item-requests/${request._id}`, { as: "exec" })).status, 404, "drafts are private");
  assert.equal((await api(`/new-item-requests/${request._id}`, { as: "tech2", method: "PUT", body: { remarks: "x" } })).status, 404);
  assert.equal((await api("/new-item-requests", { as: "store" })).status, 403);
  assert.equal((await api("/new-item-requests/pending", { as: "manager" })).status, 403, "only the Engineering Executive reviews new item requests");

  const submitted = await api(`/new-item-requests/${request._id}/submit`, { as: "tech", method: "POST" });
  assert.equal(submitted.data.request.status, "PENDING_EXECUTIVE_REVIEW");

  const queue = await api("/new-item-requests/pending", { as: "exec" });
  assert.ok(queue.data.requests.some((entry) => entry._id === request._id));
  const detail = await api(`/new-item-requests/${request._id}`, { as: "exec" });
  assert.equal(detail.data.request.projectName, "Line 3 upgrade");

  const mine = await api("/new-item-requests", { as: "tech" });
  assert.equal(mine.data.requests[0].status, "PENDING_EXECUTIVE_REVIEW");
  assert.equal((await api("/new-item-requests", { as: "tech2" })).data.total, 0);

  assert.equal((await api(`/new-item-requests/${request._id}`, { as: "tech", method: "PUT", body: { remarks: "late" } })).status, 409, "read-only after submit");
  assert.equal((await api(`/new-item-requests/${request._id}`, { as: "tech", method: "DELETE" })).status, 409);
  assert.deepEqual(await counts(), before, "no item master, inventory, or stock movement changes");

  const other = await api("/new-item-requests", { as: "tech", method: "POST", body: { department: "Eng", items: [] } });
  assert.equal((await api(`/new-item-requests/${other.data.request._id}`, { as: "tech", method: "DELETE" })).status, 200);
});
