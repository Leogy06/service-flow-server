import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { env } from "@/config/env.js";
import {
  AccessTokenPayload,
  RefreshTokenPayload,
} from "@/types/index.js";
import { AppError } from "./AppError.js";

export function generateAccessToken(user: {
  id: string;
  role: string;
}): string {
  const payload: AccessTokenPayload = { sub: user.id, role: user.role };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_EXPIRY,
  });
}

export function generateRefreshToken(user: { id: string }): string {
  const payload: RefreshTokenPayload = {
    sub: user.id,
    jti: crypto.randomUUID(),
  };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.REFRESH_TOKEN_EXPIRY,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
  if (typeof decoded === "string") {
    throw new AppError(401, "Invalid token");
  }
  return decoded as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET);
  if (typeof decoded === "string") {
    throw new AppError(401, "Invalid token");
  }
  return decoded as RefreshTokenPayload;
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
