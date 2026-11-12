import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    emailRequested: { type: Boolean, default: false },
    dedupeKey: { type: String },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    type: {
      type: String,
      enum: ["info", "success", "warning", "error"],
      default: "info",
    },
    link: {
      type: String,
      default: null,
      maxlength: 500,
    },
    sourceType: {
      type: String,
      default: null,
      trim: true,
      maxlength: 80,
    },
    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    readAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });

const Notification = mongoose.model("Notification", notificationSchema);

export default Notification;
