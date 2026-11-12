import { getEffectivePermissions } from "../middleware/authMiddleware.js";
import nodemailer from "nodemailer";
import EmailDelivery from "../models/EmailDelivery.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";

export async function enqueueEmail(notification) {
  const user = await User.findById(notification.user).select("email");
  if (!user?.email) return;
  await EmailDelivery.updateOne({ notificationId: notification._id, userId: user._id }, { $setOnInsert: {
    recipientEmail: user.email, subject: notification.title,
    text: `${notification.message}\n\n${notification.link || ""}`.trim(),
  } }, { upsert: true });
}

// Reconcile persisted notification intents after process/queue-write failures.
export async function reconcileEmails() {
  const missing = await Notification.aggregate([
    { $match: { emailRequested: true } },
    { $lookup: { from: EmailDelivery.collection.name, localField: "_id", foreignField: "notificationId", as: "deliveries" } },
    { $match: { deliveries: { $size: 0 } } }, { $limit: 100 },
  ]);
  const notifications = missing;
  for (const notification of notifications) await enqueueEmail(notification);
}
export async function processEmailQueue({ now = new Date(), transport, limit = 20 } = {}) {
  // An interrupted SMTP send has an ambiguous outcome. Quarantine instead of
  // automatically sending a potential duplicate after a worker crash.
  await EmailDelivery.updateMany({ status: "sending", leaseUntil: { $lte: now } }, {
    $set: { status: "failed", lastError: "Delivery interrupted; SMTP outcome unknown. Verify with recipient before resending.", leaseUntil: null },
  });
  const configured = Boolean(process.env.SMTP_HOST);
  if (!transport && configured) transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true", connectionTimeout: 10000, socketTimeout: 15000,
    ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } } : {}),
  });
  for (let index = 0; index < limit; index++) {
    const delivery = await EmailDelivery.findOneAndUpdate({ status: { $in: ["queued", "retrying"] }, nextAttemptAt: { $lte: now },
      $expr: { $lt: ["$attempts", "$maxAttempts"] } }, {
      $set: { status: "sending", leaseUntil: new Date(now.getTime() + 120000) }, $inc: { attempts: 1 },
    }, { returnDocument: "after", sort: { nextAttemptAt: 1 } });
    if (!delivery) break;
    let accepted = false;
    try {
      const user = await User.findById(delivery.userId).select("isActive role");
      const notification = await Notification.findById(delivery.notificationId).select("sourceType message link");
      const permissions = user?.isActive ? await getEffectivePermissions(user.role) : {};
      const sourcePage = notification?.sourceType === "MaterialRequest" ? "materialRequests" : notification?.sourceType === "NewItemRequest" ? "newItemRequests" : null;
      if (!permissions.notifications || (sourcePage && !permissions[sourcePage])) {
        await EmailDelivery.updateOne({ _id: delivery._id }, { $set: { status: "skipped", leaseUntil: null, lastError: "Recipient no longer has access" } });
        continue;
      }
      if (!transport) throw new Error("SMTP is not configured");
      await transport.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER || "wms@localhost", to: delivery.recipientEmail,
        subject: delivery.subject, text: delivery.text || `${notification?.message || ""}\n\n${notification?.link || ""}`, messageId: `<wms-${delivery._id}@warehouse.local>` });
      accepted = true;
      await EmailDelivery.updateOne({ _id: delivery._id, status: "sending" }, { $set: { status: "sent", sentAt: new Date(), lastError: null, leaseUntil: null } });
    } catch (error) {
      if (accepted) { console.error("SMTP accepted mail; delivery recording interrupted. Quarantined by lease expiry."); continue; }
      const ambiguous = Boolean(transport && !error.responseCode && error.command !== "CONN");
      await EmailDelivery.updateOne({ _id: delivery._id, status: "sending" }, { $set: {
        status: ambiguous || delivery.attempts >= delivery.maxAttempts ? "failed" : "retrying", leaseUntil: null,
        // Store only a safe category: SMTP responses can contain addresses or credentials.
        lastError: ambiguous ? "SMTP outcome unknown; verify before resending" : !transport ? "SMTP is not configured" : `SMTP delivery failed (${String(error.code || "transport error").slice(0, 80)})`,
        nextAttemptAt: new Date(now.getTime() + Math.min(3600000, 30000 * 2 ** (delivery.attempts - 1))),
      } });
    }
  }
}
export function startEmailWorker() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await reconcileEmails(); await processEmailQueue(); }
    catch { console.error("Email worker unavailable; pending deliveries retained"); }
    finally { running = false; }
  };
  void tick();
  const timer = setInterval(tick, 15000);
  timer.unref();
  return () => clearInterval(timer);
}
