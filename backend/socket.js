import http from "node:http";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { getEffectivePermissions } from "./middleware/authMiddleware.js";
import User from "./models/User.js";

let socketServer;

function readToken(socket) {
  return typeof socket.handshake?.auth?.token === "string" ? socket.handshake.auth.token : null;
}
export function socketTicket(req, res) {
  const token = jwt.sign({ purpose: "notifications", sessionExpiresAt: req.user.sessionExpiresAt }, process.env.JWT_SECRET, {
    subject: req.user.userId, audience: "wms-socket", expiresIn: "60s",
  });
  res.set("Cache-Control", "no-store").json({ token });
}

export function createSocketServer(app, allowedOrigins = []) {
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });

  io.use(async (socket, next) => {
    const token = readToken(socket);
    if (!token || !process.env.JWT_SECRET) {
      return next(new Error("Unauthorized"));
    }

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET, { audience: "wms-socket" });
      if (!payload || typeof payload !== "object" || typeof payload.sub !== "string") {
        return next(new Error("Unauthorized"));
      }
      const user = await User.findById(payload.sub).select("_id role isActive");
      if (!user || !user.isActive || !(await getEffectivePermissions(user.role)).notifications) {
        return next(new Error("Unauthorized"));
      }
      socket.authExpiresAt = payload.sessionExpiresAt;
      if (!Number.isFinite(socket.authExpiresAt) || socket.authExpiresAt <= Date.now()) return next(new Error("Unauthorized"));
      socket.user = { id: String(user._id), role: user.role };
      return next();
    } catch {
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const userRoom = `user:${socket.user.id}`;
    socket.join(userRoom);
    const expiry = setTimeout(() => socket.disconnect(true), Math.min(2147483647, socket.authExpiresAt - Date.now()));
    expiry.unref();
    socket.on("disconnect", () => clearTimeout(expiry));
    socket.emit("session", { userId: socket.user.id, role: socket.user.role });

    // Tickets expire during handshake; sessions are revalidated before each delivery.
    socket.on("ping", () => socket.emit("pong", { acknowledged: true }));
  });

  socketServer = io;
  return server;
}

export function getSocketServer() {
  return socketServer;
}

export async function emitNotification(userId, payload) {
  if (!socketServer) return false;
  const user = await User.findById(userId).select("isActive role");
  const permissions = user?.isActive ? await getEffectivePermissions(user.role) : {};
  const sourcePage = payload.sourceType === "MaterialRequest" ? "materialRequests" : payload.sourceType === "NewItemRequest" ? "newItemRequests" : null;
  if (!user?.isActive || !permissions.notifications || (sourcePage && !permissions[sourcePage])) {
    socketServer.in(`user:${String(userId)}`).disconnectSockets(true);
    return false;
  }
  socketServer.to(`user:${String(userId)}`).emit("notification:new", payload);
  return true;
}
