import mongoose from "mongoose";

const activitySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    action: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    entityType: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    ipAddress: {
      type: String,
      default: "",
      maxlength: 64,
    },
  },
  { timestamps: true },
);

const Activity = mongoose.model("Activity", activitySchema);

export default Activity;
