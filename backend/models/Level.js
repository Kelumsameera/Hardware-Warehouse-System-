import mongoose from "mongoose";

const levelSchema = new mongoose.Schema(
  {
    rack: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Rack",
      required: true,
    },
    levelCode: {
      type: String,
      required: true,
      trim: true,
    },
    levelName: {
      type: String,
      required: true,
      trim: true,
    },
    levelNumber: {
      type: Number,
      min: 1,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

levelSchema.index({ rack: 1, levelCode: 1 }, { unique: true });

const Level = mongoose.model("Level", levelSchema);

export default Level;
