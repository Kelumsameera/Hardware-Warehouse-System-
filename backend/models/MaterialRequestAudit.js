import mongoose from "mongoose";

const materialRequestAuditSchema = new mongoose.Schema(
  {
    materialRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MaterialRequest",
      required: true,
    },
    action: {
      type: String,
      required: true,
    },
    fromStatus: {
      type: String,
      default: null,
    },
    toStatus: {
      type: String,
      default: null,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    userName: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      required: true,
    },
    remarks: {
      type: String,
      default: "",
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    ipAddress: {
      type: String,
      default: "",
    },
  },
  { timestamps: true },
);

materialRequestAuditSchema.index({ materialRequest: 1, createdAt: 1 });

const MaterialRequestAudit = mongoose.model("MaterialRequestAudit", materialRequestAuditSchema);

export default MaterialRequestAudit;
