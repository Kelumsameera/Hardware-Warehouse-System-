import mongoose from "mongoose";

const binSchema = new mongoose.Schema(
  {
    gridColumn: { type: Number, min: 1, max: 20, default: null },
    archivedAt: { type: Date, default: null },
    level: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Level",
      required: true,
    },
    binCode: {
      type: String,
      required: true,
      trim: true,
    },
    binName: {
      type: String,
      required: true,
      trim: true,
    },
    binType: {
      type: String,
      enum: ["Dedicated", "Mixed"],
      default: "Mixed",
    },
    capacity: {
      type: Number,
      min: 0,
      default: null,
    },
    capacityUnit: {
      type: String,
      trim: true,
      default: null,
    },
    usedCapacity: {
      type: Number,
      min: 0,
      default: 0,
      select: false,
    },
    inventoryRevision: {
      type: Number,
      default: 0,
      select: false,
    },
    locationCode: {
      type: String,
      trim: true,
      default: null,
    },
    allowedItemGroups: {
      type: [String],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

binSchema.index({ level: 1, gridColumn: 1 }, { unique: true, partialFilterExpression: { gridColumn: { $type: "number" } } });
binSchema.index({ level: 1, binCode: 1 }, { unique: true });
binSchema.index({ locationCode: 1 }, { unique: true, partialFilterExpression: { locationCode: { $type: "string" } } });
binSchema.pre("validate", function () {
  if (this.capacity !== null && this.capacity !== undefined && !this.capacityUnit) {
    this.invalidate("capacityUnit", "Capacity unit is required when capacity is set");
  }
});

const Bin = mongoose.model("Bin", binSchema);

export default Bin;
