import express from "express";
import { bootstrapAdmin, getAssignableRoles, login, createUser, getUsers, setUserActive, getMe, changePassword, updateUser } from "../controllers/authController.js";
import { authenticateToken, requirePermission } from "../middleware/authMiddleware.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = express.Router();

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const loginEmail = (req) => (typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase().slice(0, 254) : "");
// Failed sign-ins are limited per account (brute force on one user) and per client address.
// Successful sign-ins are not counted, so many users behind the same proxy are not blocked.
const accountLoginLimiter = rateLimit({ windowMs: FIFTEEN_MINUTES, max: 10, failuresOnly: true, keyGenerator: (req) => `account:${loginEmail(req)}`, message: "Too many failed sign-in attempts for this account. Try again later." });
const addressLoginLimiter = rateLimit({ windowMs: FIFTEEN_MINUTES, max: 100, failuresOnly: true, message: "Too many failed sign-in attempts. Try again later." });
const passwordLimiter = rateLimit({ windowMs: FIFTEEN_MINUTES, max: 10, failuresOnly: true, keyGenerator: (req) => `user:${req.user?.userId}`, message: "Too many password attempts. Try again later." });
const bootstrapLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: "Too many setup attempts. Try again later." });

router.post("/bootstrap", bootstrapLimiter, bootstrapAdmin);
router.post("/login", addressLoginLimiter, accountLoginLimiter, login);
router.get("/me", authenticateToken, getMe);
router.post("/change-password", authenticateToken, requirePermission("settings"), passwordLimiter, changePassword);
router.get("/assignable-roles", authenticateToken, requirePermission("users.write"), getAssignableRoles);
router.get("/users", authenticateToken, requirePermission("users"), getUsers);
router.post("/users", authenticateToken, requirePermission("users.write"), createUser);
router.patch("/users/:id", authenticateToken, requirePermission("users.write"), updateUser);
router.patch("/users/:id/active", authenticateToken, requirePermission("users.write"), setUserActive);

export default router;
