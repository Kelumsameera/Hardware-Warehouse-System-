import mongoose from "mongoose";

const warehouseSchema = new mongoose.Schema(
  {
    warehouseCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    warehouseName: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    location: {
      type: String,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

const Warehouse = mongoose.model("Warehouse", warehouseSchema);

export default Warehouse;
