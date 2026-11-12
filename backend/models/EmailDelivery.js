import mongoose from "mongoose";

const emailDeliverySchema = new mongoose.Schema(
  {
    notificationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Notification",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    recipientEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    text: { type: String, required: true },
    leaseUntil: { type: Date, default: null },
    status: {
      type: String,
      enum: ["queued", "sending", "retrying", "sent", "skipped", "failed"],
      default: "queued",
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxAttempts: {
      type: Number,
      default: 5,
    },
    sentAt: {
      type: Date,
      default: null,
    },
    nextAttemptAt: {
      type: Date,
      default: Date.now,
    },
    lastError: {
      type: String,
      default: null,
      trim: true,
      maxlength: 500,
    },
  },
  { timestamps: true },
);

emailDeliverySchema.index({ notificationId: 1, userId: 1 }, { unique: true });
emailDeliverySchema.index({ status: 1, nextAttemptAt: 1 });

const EmailDelivery = mongoose.model("EmailDelivery", emailDeliverySchema);

export default EmailDelivery;
