import EmailDelivery from "../models/EmailDelivery.js";
import { socketTicket } from "../socket.js";
import express from "express";
import { authenticateToken, requirePermission } from "../middleware/authMiddleware.js";
import { listNotifications, markAllNotificationsRead, markNotificationRead, unreadCount } from "../controllers/notificationController.js";

const router = express.Router();
router.use(authenticateToken, requirePermission("notifications"));

router.get("/email-deliveries", requirePermission("emailDeliveries"), async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const deliveries = await EmailDelivery.find({}).select("notificationId userId subject status attempts maxAttempts lastError sentAt nextAttemptAt createdAt").sort({ createdAt: -1 }).skip((page - 1) * 50).limit(50).lean();
  res.json({ deliveries, page, total: await EmailDelivery.countDocuments({}) });
});
router.post("/socket-ticket", socketTicket);
router.get("/", listNotifications);
router.get("/unread-count", unreadCount);
router.post("/read-all", markAllNotificationsRead);
router.post("/:id/read", markNotificationRead);

export default router;
