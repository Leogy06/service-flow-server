import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { authService } from "../services/auth.service.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

const registerSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const cookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/api/auth/refresh",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// --- REGISTER ---
router.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.flatten().fieldErrors,
    });
  }
  const user = await authService.register(parsed.data);
  return res.status(201).json({ user });
});

// --- LOGIN ---
router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.flatten().fieldErrors,
    });
  }
  const { user, accessToken, refreshToken } = await authService.login(
    parsed.data.email,
    parsed.data.password,
  );
  res.cookie("refreshToken", refreshToken, cookieOptions);
  return res.json({ accessToken, user });
});

// --- REFRESH ---
router.post("/refresh", async (req, res) => {
  const token = req.cookies.refreshToken as string | undefined;
  if (!token) {
    return res.status(401).json({ error: "No refresh token" });
  }
  const { accessToken, refreshToken } = await authService.refresh(token);
  res.cookie("refreshToken", refreshToken, cookieOptions);
  return res.json({ accessToken });
});

// --- LOGOUT ---
router.post("/logout", async (req, res) => {
  await authService.logout(req.cookies.refreshToken as string | undefined);
  res.clearCookie("refreshToken", { path: "/api/auth/refresh" });
  return res.json({ message: "Logged out" });
});

// --- ME (protected) ---
router.get("/me", authenticate, async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "No token provided" });
  }
  const user = await authService.getProfile(req.user.id);
  return res.json(user);
});

export default router;
