import mongoose from "mongoose";
import bcrypt from "bcrypt";

export const ROLE_ALIASES = {
  "super admin": "Super Admin",
  "superadmin": "Super Admin",
  "warehouse admin": "Admin",
  "admin": "Admin",
  "storekeeper": "Store Keeper",
  "store keeper": "Store Keeper",
  "store-keeper": "Store Keeper",
  "supervisor": "Supervisor",
  "viewer": "Viewer",
  "technician": "Technician",
  "engineering executive": "Engineering Executive",
  "engineering manager": "Engineering Manager",
};

export const USER_ROLES = ["Super Admin", "Admin", "Supervisor", "Store Keeper", "Viewer", "Technician", "Engineering Executive", "Engineering Manager"];

export function normalizeRoleName(role) {
  if (!role || typeof role !== "string") return null;
  const trimmed = role.trim();
  if (!trimmed) return null;
  const canonical = ROLE_ALIASES[trimmed.toLowerCase()] || trimmed;
  return USER_ROLES.includes(canonical) ? canonical : null;
}

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    password: {
      type: String,
      required: true,
      minlength: 10,
      select: false,
    },
    role: {
      type: String,
      enum: USER_ROLES,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    bootstrapKey: {
      type: String,
      select: false,
    },
  },
  { timestamps: true },
);

userSchema.index({ bootstrapKey: 1 }, { unique: true, sparse: true });
userSchema.pre("validate", function normalizeRole() {
  if (typeof this.role === "string") {
    const normalized = normalizeRoleName(this.role);
    if (!normalized) throw new Error("Valid role is required");
    this.role = normalized;
  }
});
userSchema.pre("save", async function () {
  if (this.isModified("password")) this.password = await bcrypt.hash(this.password, 12);
});
userSchema.methods.comparePassword = function (password) {
  return bcrypt.compare(password, this.password);
};

const User = mongoose.model("User", userSchema);

export default User;
