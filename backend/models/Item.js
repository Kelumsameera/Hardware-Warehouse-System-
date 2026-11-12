import mongoose from "mongoose";

const itemSchema = new mongoose.Schema(
  {
    itemCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    description: {
      type: String,
      required: true,
      trim: true,
    },

    itemGroup: {
      type: String,
      trim: true,
    },

    itemType: {
      type: String,
      trim: true,
    },

    uom: {
      type: String,
      default: "Pieces",
    },

    bomType: {
      type: String,
      trim: true,
    },

    minStock: {
      type: Number,
      default: 0,
      min: 0,
    },

    maxStock: {
      type: Number,
      default: null,
      min: 0,
    },

    reorderLevel: {
      type: Number,
      default: 0,
      min: 0,
    },

    image: {
      type: String,
      default: null,
    },

    images: {
      type: [String],
      default: [],
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

const Item = mongoose.model("Item", itemSchema);

export default Item;
