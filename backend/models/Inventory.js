import mongoose from "mongoose";

const inventorySchema = new mongoose.Schema(
  {
    item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Item",
      required: true,
    },
    bin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bin",
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    reservedQuantity: {
      type: Number,
      min: 0,
      default: 0,
    },
  },
  { timestamps: true },
);

inventorySchema.index({ item: 1, bin: 1 }, { unique: true });
inventorySchema.pre("validate", function () {
  if (this.reservedQuantity > this.quantity) {
    this.invalidate("reservedQuantity", "Reserved quantity cannot exceed on-hand quantity");
  }
});

inventorySchema.virtual("availableQuantity").get(function () {
  return this.quantity - this.reservedQuantity;
});

const Inventory = mongoose.model("Inventory", inventorySchema);

export default Inventory;
