import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { env } from "../config/env.js";
import {
  generateAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  verifyRefreshToken,
} from "../utils/token.js";
import type { UserModel } from "../generated/prisma/models/User.js";
import type { RefreshTokenPayload } from "../types/index.js";

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
}

function sanitizeUser(user: UserModel) {
  const { password: _password, ...safe } = user;
  return safe;
}

async function issueRefreshToken(user: { id: string }): Promise<string> {
  const refreshToken = generateRefreshToken(user);
  await prisma.refreshToken.create({
    data: {
      token: hashRefreshToken(refreshToken),
      userId: user.id,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_EXPIRY * 1000),
    },
  });
  return refreshToken;
}

export const authService = {
  async register(input: RegisterInput) {
    const existing = await prisma.user.findUnique({
      where: { email: input.email },
    });
    if (existing) {
      throw new AppError(409, "User already exists");
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await prisma.user.create({
      data: {
        email: input.email,
        password: passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone ?? null,
      },
    });
    return sanitizeUser(user);
  },

  async login(email: string, password: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new AppError(401, "Invalid credentials");
    }
    if (user.status !== "ACTIVE") {
      throw new AppError(403, "Account is inactive");
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = await issueRefreshToken(user);
    return { user: sanitizeUser(user), accessToken, refreshToken };
  },

  async getProfile(id: string) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new AppError(404, "User not found");
    }
    return sanitizeUser(user);
  },

  async refresh(rawToken: string) {
    let payload: RefreshTokenPayload;
    try {
      payload = verifyRefreshToken(rawToken);
    } catch {
      throw new AppError(401, "Invalid or expired refresh token");
    }

    const tokenHash = hashRefreshToken(rawToken);
    const stored = await prisma.refreshToken.findUnique({
      where: { token: tokenHash },
    });
    if (
      !stored ||
      stored.userId !== payload.sub ||
      stored.expiresAt.getTime() <= Date.now()
    ) {
      throw new AppError(401, "Invalid or expired refresh token");
    }

    const user = await prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user || user.status !== "ACTIVE") {
      throw new AppError(401, "Invalid or expired refresh token");
    }

    await prisma.refreshToken.delete({ where: { id: stored.id } });
    const accessToken = generateAccessToken(user);
    const refreshToken = await issueRefreshToken(user);
    return { accessToken, refreshToken };
  },

  async logout(rawToken: string | undefined) {
    if (!rawToken) return;
    try {
      verifyRefreshToken(rawToken);
    } catch {
      return;
    }
    await prisma.refreshToken.deleteMany({
      where: { token: hashRefreshToken(rawToken) },
    });
  },
};
