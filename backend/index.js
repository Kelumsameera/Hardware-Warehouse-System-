import { startEmailWorker } from "./services/emailService.js";
import { ensureRolePermissions } from "./models/RolePermission.js";
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import mongoose from "mongoose";
import itemRoutes from "./routes/itemRoutes.js";
import warehouseRoutes from "./routes/warehouseRoutes.js";
import zoneRoutes from "./routes/zoneRoutes.js";
import rackRoutes from "./routes/rackRoutes.js";
import levelRoutes from "./routes/levelRoutes.js";
import binRoutes from "./routes/binRoutes.js";
import inventoryRoutes from "./routes/inventoryRoutes.js";
import stockMovementRoutes from "./routes/stockMovementRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import activityRoutes from "./routes/activityRoutes.js";
import alertRoutes from "./routes/alertRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import materialRequestRoutes from "./routes/materialRequestRoutes.js";
import newItemRequestRoutes from "./routes/newItemRequestRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import permissionRoutes from "./routes/permissionRoutes.js";
import { authenticateToken, requireAnyPermission } from "./middleware/authMiddleware.js";
import { UPLOAD_ROOT } from "./controllers/itemImageController.js";
import { pathToFileURL } from "node:url";
import { createSocketServer } from "./socket.js";
const app = express();

// The Next.js frontend proxies API calls from the same machine, so only trust
// X-Forwarded-For from loopback. This keeps req.ip (rate limits, audit logs) accurate.
app.set("trust proxy", "loopback");

const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({ origin: allowedOrigins }));
app.use(helmet());
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.send("Hello, World!");
});

app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok", database: mongoose.connection.readyState === 1 ? "connected" : "disconnected" });
});

const PORT = process.env.PORT || 4000;
const MONGODB_URI = process.env.MONGODB_URI;

app.use("/api/items", itemRoutes);
app.use("/api/warehouses", warehouseRoutes);
app.use("/api/zones", zoneRoutes);
app.use("/api/racks", rackRoutes);
app.use("/api/levels", levelRoutes);
app.use("/api/bins", binRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/stock-movements", stockMovementRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/activities", activityRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/material-requests", materialRequestRoutes);
app.use("/api/new-item-requests", newItemRequestRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/permissions", permissionRoutes);
app.use("/api/uploads", authenticateToken, requireAnyPermission("items", "materialRequests", "newItemRequests"), express.static(UPLOAD_ROOT, { fallthrough: false, dotfiles: "deny", index: false }));

app.use("/api", (req, res) => {
  res.status(404).json({ message: "API route not found" });
});

// Keep error responses JSON (malformed JSON bodies, oversized payloads, missing upload files).
// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
  const status = error.status || error.statusCode || 500;
  if (status >= 500) console.error(error);
  const message = error.type === "entity.parse.failed"
    ? "Request body must be valid JSON"
    : error.type === "entity.too.large"
      ? "Request body is too large"
      : status === 404
        ? "File not found"
        : status >= 500
          ? "Internal server error"
          : error.message;
  res.status(status).json({ message });
});

export { app };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mongoose
    .connect(MONGODB_URI)
    .then(async () => {
      await ensureRolePermissions();
      startEmailWorker();
      console.log("Connected to MongoDB");

      const server = createSocketServer(app, allowedOrigins);
      server.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
      });
    })
    .catch((error) => {
      console.error("Error connecting to MongoDB:", error);
    });
}
