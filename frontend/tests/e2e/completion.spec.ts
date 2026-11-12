import { mkdir } from "node:fs/promises";
import { test, expect, type BrowserContext } from "@playwright/test";
test.beforeAll(async () => { await mkdir("output/qa", { recursive: true }); });
async function login(context: BrowserContext, email = "admin@ui.qa") {
  const response = await context.request.post("/api/session", { headers: { "x-wms-request": "1", Origin: "http://localhost:3008" }, data: { email, password: "UiTestPassword123!" } });
  expect(response.status()).toBe(200);
}
const routes = ["/", "/items", "/warehouses", "/inventory", "/material-requests", "/material-requests/new", "/material-requests/availability", "/new-item-requests", "/new-item-requests/edit", "/movements", "/alerts", "/notifications", "/reports", "/permissions", "/users", "/settings"];
for (const [device, width] of [["mobile", 390], ["tablet", 768], ["desktop", 1440]] as const) {
  test(`all principal screens fit ${device}`, async ({ page, context }) => {
    test.setTimeout(180000);
    await login(context); await page.setViewportSize({ width, height: 900 });
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    for (const route of routes) {
      await page.goto(route); await expect(page.locator("#main-content")).toBeVisible();
      await expect(page.getByText("Loading your session...")).toHaveCount(0);
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
      if (!fits) console.log(route, await page.evaluate(() => Array.from(document.querySelectorAll("body *")).filter((element) => element.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(element).position !== "absolute").slice(0, 12).map((element) => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right, text: element.textContent?.slice(0, 60) }))));
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), { message: `${route} overflows ${device}` }).toBe(true);
      await expect(page.getByRole("heading", { name: "Access denied", exact: true })).toHaveCount(0);
    }
    expect(errors).toEqual([]);
    await page.screenshot({ path: `output/qa/${device}-settings.png`, fullPage: true });
  });
}
test("rack grid edits persist and mobile becomes a list", async ({ page, context }) => {
  await login(context); await page.goto("/warehouses");
  await page.getByLabel("Designer rack").selectOption({ index: 1 });
  await expect(page.getByLabel("Rack grid")).toBeVisible();
  await page.getByLabel("Grid rows").fill("3"); await page.getByRole("button", { name: "Save grid" }).click();
  await expect(page.getByRole("heading", { name: "Row 3", exact: true })).toBeVisible();
  const bin = page.getByLabel("Rack grid").getByRole("button").first(); await bin.click();
  await page.getByLabel("Bin name").fill("Renamed in browser"); await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page.getByText("Renamed in browser", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.locator(".rack-bin-grid").first().evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(1);
  await page.screenshot({ path: "output/qa/mobile-rack.png", fullPage: true });
});
test("two browser users receive live notification, unread count and missed history", async ({ browser }) => {
  const tech = await browser.newContext(), executive = await browser.newContext();
  try {
    await login(tech, "tech@ui.qa"); await login(executive, "exec@ui.qa");
    const sender = await tech.newPage(), recipient = await executive.newPage();
    await sender.goto("/material-requests"); await recipient.goto("/notifications");
    const items = await tech.request.get("/api/backend/items?limit=1").then((response) => response.json());
    const created = await tech.request.post("/api/backend/material-requests", { headers: { "x-wms-request": "1", Origin: "http://localhost:3008" }, data: { department: "Live browser QA", items: [{ item: items.items[0]._id, requestedQuantity: 1 }] } });
    expect(created.status()).toBe(201); const mr = (await created.json()).materialRequest;
    const submitted = await tech.request.post(`/api/backend/material-requests/${mr._id}/submit`, { headers: { "x-wms-request": "1", Origin: "http://localhost:3008" } });
    expect(submitted.status()).toBe(200);
    await expect(recipient.getByText(new RegExp(mr.mrNumber)).first()).toBeVisible({ timeout: 10000 });
    await expect(recipient.getByRole("link", { name: /unread notifications/ })).toBeVisible();
    await executive.setOffline(true);
    const missed = await tech.request.post("/api/backend/material-requests", { headers: { "x-wms-request": "1", Origin: "http://localhost:3008" }, data: { department: "Offline browser QA", items: [{ item: items.items[0]._id, requestedQuantity: 1 }], submit: true } });
    expect(missed.status()).toBe(201); const offlineMr = (await missed.json()).materialRequest;
    await executive.setOffline(false);
    await expect(recipient.getByText(new RegExp(offlineMr.mrNumber)).first()).toBeVisible({ timeout: 20000 });
  } finally { await tech.close(); await executive.close(); }
});
test("permissions refresh in active browser and direct API access is revoked", async ({ browser }) => {
  const admin = await browser.newContext(), viewer = await browser.newContext();
  try {
    await login(admin); await login(viewer, "viewer@ui.qa");
    const page = await viewer.newPage(); await page.goto("/inventory");
    const roles = await admin.request.get("/api/backend/permissions/roles").then((response) => response.json());
    const permissions = roles.roles.find((entry: { role: string }) => entry.role === "Viewer").permissions;
    const changed = await admin.request.put("/api/backend/permissions/roles/Viewer", { headers: { "x-wms-request": "1", Origin: "http://localhost:3008" }, data: { permissions: { ...permissions, inventory: false } } });
    expect(changed.status()).toBe(200);
    expect((await viewer.request.get("/api/backend/inventory")).status()).toBe(403);
    await expect(page.getByRole("heading", { name: "Access denied", exact: true })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Inventory", exact: true })).toHaveCount(0);
  } finally { await admin.close(); await viewer.close(); }
});
test("material request long table and images render with A4 print rules", async ({ page, context }) => {
  await login(context);
  const list = await context.request.get("/api/backend/material-requests?limit=100").then((response) => response.json());
  const mr = list.requests.find((entry: { mrNumber: string }) => entry.mrNumber === "MR-QA-PRINT");
  await page.goto(`/documents/material-request?id=${mr._id}`);
  await expect(page.getByRole("heading", { name: "MATERIAL REQUEST FORM" })).toBeVisible();
  await expect(page.locator(".doc-table tbody tr")).toHaveCount(42);
  await expect.poll(() => page.locator(".doc-table img").evaluateAll((images) => images.length > 0 && images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.emulateMedia({ media: "print" });
  expect(await page.locator(".doc-table thead").evaluate((element) => getComputedStyle(element).display)).toBe("table-header-group");
  await expect(page.getByRole("button", { name: "Print / Save as PDF" })).toBeHidden();
  expect(await page.locator(".doc-table tbody tr").first().evaluate((element) => getComputedStyle(element).breakInside)).toBe("avoid");
  expect(await page.locator("style").allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining("size: A4 portrait")]));
  await page.screenshot({ path: "output/qa/material-request-print.png", fullPage: true });
  await page.pdf({ path: "output/qa/material-request-a4.pdf", preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: "screen" });
  await page.getByLabel("Landscape").check();
  await page.emulateMedia({ media: "print" });
  await page.pdf({ path: "output/qa/material-request-a4-landscape.pdf", preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: "screen" }); await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("detail screens and both document previews fit every viewport", async ({ page, context }) => {
  await login(context);
  const material = await context.request.get("/api/backend/material-requests?limit=100").then((response) => response.json());
  const mr = material.requests.find((entry: { mrNumber: string }) => entry.mrNumber === "MR-QA-PRINT");
  const requests = await context.request.get("/api/backend/new-item-requests?limit=100").then((response) => response.json());
  const nir = requests.requests.find((entry: { requestNumber: string }) => entry.requestNumber === "NIR-QA");
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of [`/material-requests/view?id=${mr._id}`, `/new-item-requests/view?id=${nir._id}`, `/documents/material-request?id=${mr._id}`, `/documents/new-item-request?id=${nir._id}`]) {
      await page.goto(route);
      await expect(page.getByRole("heading").first()).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), { message: `${route} overflows at ${width}` }).toBe(true);
    }
  }
});

test("permission editor persists an action grant and its audit entry", async ({ page, context }) => {
  await login(context); await page.goto("/permissions");
  const roleCard = page.locator("section").filter({ has: page.getByRole("heading", { name: "Store Keeper", exact: true }) });
  const checkbox = roleCard.getByRole("checkbox", { name: "movements.write", exact: true });
  await expect(checkbox).toBeChecked(); await checkbox.uncheck();
  const saved = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().includes("/permissions/roles/"));
  await roleCard.getByRole("button", { name: "Save", exact: true }).click(); expect((await saved).status()).toBe(200);
  await expect(checkbox).not.toBeChecked();
  const roles = await context.request.get("/api/backend/permissions/roles").then((response) => response.json());
  expect(roles.roles.find((entry: { role: string }) => entry.role === "Store Keeper").permissions["movements.write"]).toBe(false);
  const audit = await context.request.get("/api/backend/permissions/audit").then((response) => response.json());
  expect(audit.entries.some((entry: { details: { role: string } }) => entry.details.role === "Store Keeper")).toBe(true);
});
