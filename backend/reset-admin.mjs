import mongoose from "mongoose";
import User from "./models/User.js";
import dotenv from "dotenv";
import readline from "node:readline";

dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function resetPassword() {
  try {
    const password = await new Promise((resolve) => {
      rl.question("Enter new Admin password: ", resolve);
    });

    if (password.length < 10) {
      throw new Error("Password must be at least 10 characters.");
    }

    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is missing.");
    }

    await mongoose.connect(process.env.MONGODB_URI);

    const user = await User.findOne({
      email: "admin@example.com"
    });

    if (!user) {
      throw new Error("Admin account not found.");
    }

    user.password = password;
    await user.save();

    console.log("Admin password reset successfully.");
  } catch (error) {
    console.error("Reset failed:", error.message);
  } finally {
    rl.close();
    await mongoose.disconnect();
  }
}

resetPassword();
