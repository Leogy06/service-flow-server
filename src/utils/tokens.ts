import jwt, { SignOptions } from "jsonwebtoken";
import crypto from "crypto";
import { User } from "@/generated/prisma/client.js";
import { AccessTokenPayload } from "@/types/index.js";
import { env } from "@/config/env.js";

const ACCESS_SECRET = env.JWT_ACCESS_SECRET;
const ACCESS_EXPIRY = env.ACCESS_TOKEN_EXPIRY;

console.log("ACCESS_SECRET:", ACCESS_SECRET);
console.log("ACCESS_EXPIRY:", ACCESS_EXPIRY);

export const REFRESH_TOKEN_DAYS = env.REFRESH_TOKEN_DAYS;

if (!ACCESS_SECRET) {
  throw new Error("JWT_ACCESS_SECRET is not set");
}

export function generateAccessToken(user: Pick<User, "id" | "role">): string {
  const payload: AccessTokenPayload = { sub: user.id, role: user.role };
  const options: SignOptions = { expiresIn: ACCESS_EXPIRY };
  return jwt.sign(payload, ACCESS_SECRET, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, ACCESS_SECRET) as AccessTokenPayload;
}

// Opaque refresh token — random bytes, given raw to client, only the hash lives in DB
export function generateRefreshTokenValue(): string {
  return crypto.randomBytes(64).toString("hex");
}

export function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export function getRefreshExpiry(): Date {
  const d = new Date();
  d.setDate(d.getDate() + REFRESH_TOKEN_DAYS);
  return d;
}
