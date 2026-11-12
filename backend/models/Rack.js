import mongoose from "mongoose";

const rackSchema = new mongoose.Schema(
  {
    gridRows: { type: Number, min: 1, max: 20, default: 1 },
    gridColumns: { type: Number, min: 1, max: 20, default: 1 },
    zone: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Zone",
      required: true,
    },
    rackCode: {
      type: String,
      required: true,
      trim: true,
    },
    rackName: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

rackSchema.index({ zone: 1, rackCode: 1 }, { unique: true });

const Rack = mongoose.model("Rack", rackSchema);

export default Rack;
