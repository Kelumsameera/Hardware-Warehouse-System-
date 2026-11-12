import mongoose from "mongoose";

const zoneSchema = new mongoose.Schema(
  {
    warehouse: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
    },
    zoneCode: {
      type: String,
      required: true,
      trim: true,
    },
    zoneName: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
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

zoneSchema.index({ warehouse: 1, zoneCode: 1 }, { unique: true });

const Zone = mongoose.model("Zone", zoneSchema);

export default Zone;
