import mongoose from "mongoose";

const stockMovementSchema = new mongoose.Schema(
  {
    transactionReference: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    movementType: {
      type: String,
      enum: ["receipt", "issue", "transfer", "adjustment", "return"],
      required: true,
    },
    item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Item",
      required: true,
    },
    sourceBin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bin",
      default: null,
    },
    destinationBin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bin",
      default: null,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0.000001,
    },
    adjustmentDirection: {
      type: String,
      enum: ["increase", "decrease"],
      default: null,
    },
    remarks: {
      type: String,
      trim: true,
      default: "",
      maxlength: 1000,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    occurredAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

const StockMovement = mongoose.model("StockMovement", stockMovementSchema);

export default StockMovement;
