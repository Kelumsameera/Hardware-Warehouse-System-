import mongoose from "mongoose";

export const NEW_ITEM_STATUSES = ["DRAFT", "PENDING_EXECUTIVE_REVIEW"];
export const NEW_ITEM_PRIORITIES = ["Low", "Normal", "High", "Urgent"];

const newItemLineSchema = new mongoose.Schema({
  itemName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
  },
  description: {
    type: String,
    default: "",
    maxlength: 1000,
  },
  specification: {
    type: String,
    default: "",
    maxlength: 2000,
  },
  quantity: {
    type: Number,
    required: true,
    min: 0.000001,
  },
  unit: {
    type: String,
    required: true,
    trim: true,
    maxlength: 40,
  },
  remarks: {
    type: String,
    default: "",
    maxlength: 500,
  },
  referenceImage: {
    type: String,
    default: null,
  },
});

const newItemRequestSchema = new mongoose.Schema(
  {
    requestNumber: {
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
    projectName: {
      type: String,
      default: "",
      trim: true,
      maxlength: 200,
    },
    workOrderNumber: {
      type: String,
      default: "",
      trim: true,
      maxlength: 60,
    },
    priority: {
      type: String,
      enum: NEW_ITEM_PRIORITIES,
      default: "Normal",
    },
    justification: {
      type: String,
      default: "",
      maxlength: 2000,
    },
    remarks: {
      type: String,
      default: "",
      maxlength: 1000,
    },
    status: {
      type: String,
      enum: NEW_ITEM_STATUSES,
      default: "DRAFT",
    },
    submittedAt: {
      type: Date,
      default: null,
    },
    items: {
      type: [newItemLineSchema],
      default: [],
    },
  },
  { timestamps: true },
);

newItemRequestSchema.index({ status: 1, createdAt: -1 });
newItemRequestSchema.index({ requestedBy: 1, createdAt: -1 });

const NewItemRequest = mongoose.model("NewItemRequest", newItemRequestSchema);

export default NewItemRequest;
