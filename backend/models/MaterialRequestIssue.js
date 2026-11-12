import mongoose from "mongoose";

const issueLineSchema = new mongoose.Schema(
  {
    line: { type: mongoose.Schema.Types.ObjectId, required: true },
    item: { type: mongoose.Schema.Types.ObjectId, ref: "Item", required: true },
    itemCode: { type: String, required: true },
    bin: { type: mongoose.Schema.Types.ObjectId, ref: "Bin", required: true },
    binCode: { type: String, default: "" },
    quantity: { type: Number, required: true, min: 0.000001 },
    stockMovement: { type: mongoose.Schema.Types.ObjectId, ref: "StockMovement", required: true },
  },
  { _id: false },
);

const materialRequestIssueSchema = new mongoose.Schema(
  {
    materialRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MaterialRequest",
      required: true,
    },
    mrNumber: {
      type: String,
      required: true,
    },
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      maxlength: 100,
    },
    issueType: {
      type: String,
      enum: ["full", "partial"],
      required: true,
    },
    lines: {
      type: [issueLineSchema],
      default: [],
    },
    issuedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    issuedByName: {
      type: String,
      required: true,
    },
    remarks: {
      type: String,
      default: "",
      maxlength: 1000,
    },
    issuedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

materialRequestIssueSchema.index({ materialRequest: 1, issuedAt: 1 });

const MaterialRequestIssue = mongoose.model("MaterialRequestIssue", materialRequestIssueSchema);

export default MaterialRequestIssue;
