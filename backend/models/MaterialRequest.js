import mongoose from "mongoose";

export const MR_STATUSES = ["DRAFT", "PENDING_APPROVAL", "REJECTED", "PENDING_ISSUE", "PARTIALLY_ISSUED", "ON_HOLD", "ISSUED", "RECEIVED"];

const personSchema = {
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  name: { type: String, default: "" },
  role: { type: String, default: "" },
  date: { type: Date, default: null },
  remarks: { type: String, default: "", maxlength: 1000 },
};

const lineSchema = new mongoose.Schema({
  item: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Item",
    required: true,
  },
  itemCode: { type: String, required: true },
  description: { type: String, required: true },
  uom: { type: String, default: "" },
  requestedQuantity: {
    type: Number,
    required: true,
    min: 0.000001,
  },
  issuedQuantity: {
    type: Number,
    default: 0,
    min: 0,
  },
  receivedQuantity: {
    type: Number,
    default: 0,
    min: 0,
  },
  remarks: {
    type: String,
    default: "",
    maxlength: 500,
  },
});

const materialRequestSchema = new mongoose.Schema(
  {
    mrNumber: {
      type: String,
      required: true,
      unique: true,
    },
    department: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    workOrderNumber: {
      type: String,
      default: "",
      trim: true,
      maxlength: 60,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    requestedByName: {
      type: String,
      required: true,
    },
    requestDate: {
      type: Date,
      default: Date.now,
    },
    remarks: {
      type: String,
      default: "",
      maxlength: 1000,
    },
    status: {
      type: String,
      enum: MR_STATUSES,
      default: "DRAFT",
    },
    items: {
      type: [lineSchema],
      default: [],
    },
    submittedAt: {
      type: Date,
      default: null,
    },
    approval: {
      decision: { type: String, enum: ["APPROVED", "REJECTED"], default: null },
      ...personSchema,
    },
    hold: {
      ...personSchema,
      previousStatus: { type: String, default: null },
    },
    issuedAt: {
      type: Date,
      default: null,
    },
    receipts: {
      type: [
        new mongoose.Schema({
          ...personSchema,
          lines: [{ _id: false, line: mongoose.Schema.Types.ObjectId, itemCode: String, quantity: Number }],
        }),
      ],
      default: [],
    },
  },
  { timestamps: true },
);

materialRequestSchema.index({ status: 1, createdAt: -1 });
materialRequestSchema.index({ requestedBy: 1, createdAt: -1 });

const MaterialRequest = mongoose.model("MaterialRequest", materialRequestSchema);

export default MaterialRequest;
