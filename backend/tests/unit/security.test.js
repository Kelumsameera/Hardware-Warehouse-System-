import { test, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "unit-test-secret-value";
process.env.CLIENT_ORIGIN = "http://localhost:3000";

const { app } = await import("../../index.js");
const { rateLimit } = await import("../../middleware/rateLimit.js");
const { requirePermission, requireRoles } = await import("../../middleware/authMiddleware.js");

const server = app.listen(0);
const baseUrl = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

const mockResponse = () => {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.set = (name, value) => { res.headers[name] = value; return res; };
  return res;
};

test("health endpoint responds without a database connection", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "ok");
});

test("unknown API routes return JSON 404", async () => {
  const response = await fetch(`${baseUrl}/api/does-not-exist`);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).message, "API route not found");
});

const protectedRoutes = [
  "/api/items", "/api/items/filters", "/api/warehouses", "/api/zones", "/api/racks", "/api/levels", "/api/bins",
  "/api/inventory", "/api/stock-movements", "/api/alerts", "/api/reports/items.xlsx", "/api/dashboard",
  "/api/auth/me", "/api/auth/users", "/api/activities", "/api/uploads/items/x.png",
  "/api/material-requests", "/api/material-requests/approvals", "/api/material-requests/issue-queue",
  "/api/notifications", "/api/permissions/roles", "/api/auth/assignable-roles",
  "/api/items/availability", "/api/new-item-requests", "/api/new-item-requests/pending",
];

for (const route of protectedRoutes) {
  test(`GET ${route} requires a bearer token`, async () => {
    const response = await fetch(`${baseUrl}${route}`);
    assert.equal(response.status, 401);
  });
}

test("state-changing stock routes require a bearer token", async () => {
  for (const route of ["receipts", "issues", "transfers", "adjustments", "returns"]) {
    const response = await fetch(`${baseUrl}/api/stock-movements/${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(response.status, 401, route);
  }
});

test("invalid and expired tokens are rejected", async () => {
  const forged = jwt.sign({ role: "Super Admin" }, "wrong-secret", { subject: "507f1f77bcf86cd799439011" });
  const expired = jwt.sign({ role: "Super Admin" }, process.env.JWT_SECRET, { subject: "507f1f77bcf86cd799439011", expiresIn: -10 });
  for (const token of [forged, expired, "not-a-token"]) {
    const response = await fetch(`${baseUrl}/api/items`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 401);
  }
});

test("malformed JSON returns a JSON 400 response", async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{bad" });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).message, "Request body must be valid JSON");
});

test("oversized JSON bodies are rejected", async () => {
  const body = JSON.stringify({ email: "x".repeat(1024 * 1024 + 10) });
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  assert.equal(response.status, 413);
});

test("CORS only allows the configured client origin", async () => {
  const allowed = await fetch(`${baseUrl}/api/health`, { headers: { Origin: "http://localhost:3000" } });
  assert.equal(allowed.headers.get("access-control-allow-origin"), "http://localhost:3000");
  const blocked = await fetch(`${baseUrl}/api/health`, { headers: { Origin: "http://evil.example" } });
  assert.equal(blocked.headers.get("access-control-allow-origin"), null);
});

test("helmet security headers are present", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.ok(response.headers.get("content-security-policy"));
});

test("requireRoles blocks roles outside the allow list", () => {
  const middleware = requireRoles("Super Admin", "Admin");
  let nextCalled = false;
  const res = mockResponse();
  middleware({ user: { role: "Viewer" } }, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);

  middleware({ user: { role: "Warehouse Admin" } }, mockResponse(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test("requireRoles accepts legacy role aliases across the canonical role set", () => {
  const middleware = requireRoles("Super Admin", "Admin", "Store Keeper");
  let nextCalled = false;
  middleware({ user: { role: "Storekeeper" } }, mockResponse(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test("requirePermission fails closed when the permission database is unavailable", async () => {
  const RolePermission = (await import("../../models/RolePermission.js")).default;
  const original = RolePermission.findOne;
  RolePermission.findOne = () => ({ lean: async () => { throw new Error("offline"); } });
  try {
    const res = mockResponse();
    let called = false;
    await requirePermission("materialRequests")({ user: { role: "Super Admin" } }, res, () => { called = true; });
    assert.equal(called, false);
    assert.equal(res.statusCode, 503);
  } finally { RolePermission.findOne = original; }
});

test("rate limiter returns 429 after the limit is reached", () => {
  const limiter = rateLimit({ windowMs: 60000, max: 2, message: "slow down" });
  const results = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = mockResponse();
    let passed = false;
    limiter({ ip: "10.0.0.1" }, res, () => { passed = true; });
    results.push(passed ? 200 : res.statusCode);
  }
  assert.deepEqual(results, [200, 200, 429]);
});

test("failure-only rate limiter ignores successful requests", async () => {
  const { EventEmitter } = await import("node:events");
  const limiter = rateLimit({ windowMs: 60000, max: 2, message: "slow down", failuresOnly: true });
  const run = (statusCode) => {
    const res = new EventEmitter();
    res.statusCode = 200;
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = () => res;
    res.set = () => res;
    let passed = false;
    limiter({ ip: "10.0.0.2" }, res, () => { passed = true; });
    if (passed) { res.statusCode = statusCode; res.emit("finish"); }
    return passed ? statusCode : res.statusCode;
  };
  assert.deepEqual([run(200), run(200), run(200), run(401), run(401), run(200)], [200, 200, 200, 401, 401, 429]);
});
