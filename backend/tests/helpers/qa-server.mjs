import mongoose from "mongoose";
import fs from "node:fs/promises";
import path from "node:path";
const uri = process.env.MONGODB_TEST_URI;
if (!uri || !/^mongodb:\/\/127\.0\.0\.1:27028\/wms_ui_test(?:\?|$)/.test(uri)) throw new Error("QA requires the isolated wms_ui_test database on port 27028");
process.env.JWT_SECRET = "ui-qa-only-secret";
process.env.SMTP_HOST = "";
await mongoose.connect(uri);
await mongoose.connection.db.dropDatabase();
const { default: User } = await import("../../models/User.js");
const { ensureRolePermissions } = await import("../../models/RolePermission.js");
const { default: Item } = await import("../../models/Item.js");
const { default: MaterialRequest } = await import("../../models/MaterialRequest.js");
await ensureRolePermissions();
for (const [role, email] of [["Super Admin", "admin@ui.qa"], ["Technician", "tech@ui.qa"], ["Engineering Executive", "exec@ui.qa"], ["Viewer", "viewer@ui.qa"]]) await User.create({ fullName: `QA ${role}`, email, role, password: "UiTestPassword123!" });
const { app } = await import("../../index.js");
const { createSocketServer } = await import("../../socket.js");
const server = createSocketServer(app, ["http://localhost:3008"]);
await new Promise((resolve) => server.listen(4008, "127.0.0.1", resolve));
const login = await fetch("http://127.0.0.1:4008/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@ui.qa", password: "UiTestPassword123!" }) }).then((response) => response.json());
async function post(url, body) {
  const response = await fetch(`http://127.0.0.1:4008/api${url}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.token}` }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw new Error(JSON.stringify(data)); return data;
}
const warehouse = (await post("/warehouses", { warehouseCode: "QA", warehouseName: "QA Warehouse" })).warehouse._id;
const zone = (await post("/zones", { warehouse, zoneCode: "QA", zoneName: "QA Zone" })).zone._id;
const rack = (await post("/racks", { zone, rackCode: "QA-RACK", rackName: "QA rack" })).rack._id;
await fetch(`http://127.0.0.1:4008/api/racks/${rack}/grid`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.token}` }, body: JSON.stringify({ rows: 2, columns: 3 }) });
const items = [];
for (let index = 1; index <= 42; index++) items.push(await Item.create({ itemCode: `QA-${String(index).padStart(3, "0")}`, description: `Long item description ${index} ? mechanical engineering bearing assembly with specifications and storage notes`, uom: "Pieces", minStock: 1 }));
const image = Buffer.from("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", "base64");
const form = new FormData(); form.append("image", new Blob([image], { type: "image/png" }), "qa.png");
const uploaded = await fetch(`http://127.0.0.1:4008/api/items/${items[0]._id}/images`, { method: "POST", headers: { Authorization: `Bearer ${login.token}` }, body: form }).then((response) => response.json());
const tech = await User.findOne({ email: "tech@ui.qa" });
await MaterialRequest.create({ mrNumber: "MR-QA-PRINT", status: "PENDING_APPROVAL", submittedAt: new Date(), department: "Engineering QA", requestedBy: tech._id, requestedByName: tech.fullName, items: items.map((item) => ({ item: item._id, itemCode: item.itemCode, description: item.description, uom: item.uom, requestedQuantity: 12, remarks: "Long line remark for responsive and print verification" })) });
const { default: NewItemRequest } = await import("../../models/NewItemRequest.js");
await NewItemRequest.create({ requestNumber: "NIR-QA", department: "Engineering QA", requestedBy: tech._id, requestedByName: tech.fullName, status: "PENDING_EXECUTIVE_REVIEW", items: [{ itemName: "QA proposed bearing", quantity: 2, unit: "Pieces", description: "Long proposed item description for responsive validation" }] });
console.log("QA backend ready on 4008");
async function stop() {
  if (uploaded.item?.images?.[0]) {
    const { UPLOAD_ROOT } = await import("../../controllers/itemImageController.js");
    await fs.unlink(path.join(UPLOAD_ROOT, "items", path.basename(uploaded.item.images[0]))).catch(() => {});
  }
  server.close(); await mongoose.disconnect(); process.exit(0);
}
process.on("SIGTERM", stop); process.on("SIGINT", stop);
