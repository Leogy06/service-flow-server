import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma.js";
import { AppError } from "@/utils/AppError.js"; // adjust path to wherever yours lives
import {
  generateAccessToken,
  generateRefreshTokenValue,
  hashToken,
  getRefreshExpiry,
} from "@/utils/tokens.js";
import { auditService } from "./audit.service.js";

interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  suffix?: string;
  phone?: string;
}

export const authService = {
  async register(input: RegisterInput) {
    const existing = await prisma.user.findUnique({
      where: { email: input.email },
    });
    if (existing) throw new AppError(409, "Email already in use");

    const passwordHash = await bcrypt.hash(input.password, 12);

    return prisma.user.create({
      data: {
        email: input.email,
        password: passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        middleName: input.middleName,
        suffix: input.suffix,
        phone: input.phone,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
      },
    });
  },

  async login(email: string, password: string) {
    const user = await prisma.user.findUnique({
      where: { email, status: "ACTIVE" },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        middleName: true,
        suffix: true,
        role: true,
        status: true,
        organizationId: true,
        password: true,
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new AppError(401, "Invalid credentials");
    }

    if (user.status !== "ACTIVE") {
      throw new AppError(403, "Account is inactive");
    }

    const accessToken = generateAccessToken(user);
    const rawRefreshToken = generateRefreshTokenValue();

    await prisma.refreshToken.create({
      data: {
        token: hashToken(rawRefreshToken),
        userId: user.id,
        organizationId: user.organizationId,
        expiresAt: getRefreshExpiry(),
      },
    });

    //audit log
    void auditService.record({
      action: "auth.login.success",
      entity: "User",
      entityId: user.id,
      after: JSON.stringify({ ...user, password: null }),
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        middleName: user?.middleName,
        suffix: user?.suffix,
        role: user.role,
        slug: user.organization?.slug,
      },
      organization: user.organization ?? null,
    };
  },

  async refresh(rawRefreshToken: string) {
    const hashed = hashToken(rawRefreshToken);

    const stored = await prisma.refreshToken.findUnique({
      where: { token: hashed },
      include: {
        user: {
          select: {
            id: true,
            role: true,
            status: true,
            organizationId: true,
            firstName: true,
            lastName: true,
            middleName: true,
            suffix: true,
            email: true,
            organization: {
              select: {
                slug: true,
              },
            },
          },
        },
      },
    });

    if (!stored) throw new AppError(401, "Invalid refresh token");

    if (stored.expiresAt < new Date()) {
      await prisma.refreshToken.delete({ where: { id: stored.id } });
      throw new AppError(401, "Refresh token expired");
    }

    if (stored.user.status !== "ACTIVE") {
      throw new AppError(403, "Account is inactive");
    }

    const newRawToken = generateRefreshTokenValue();

    await prisma.$transaction([
      prisma.refreshToken.delete({ where: { id: stored.id } }),
      prisma.refreshToken.create({
        data: {
          token: hashToken(newRawToken),
          userId: stored.userId,
          expiresAt: getRefreshExpiry(),
        },
      }),
    ]);

    const accessToken = generateAccessToken(stored.user);

    return { accessToken, refreshToken: newRawToken };
  },

  async logout(rawRefreshToken: string) {
    const hashed = hashToken(rawRefreshToken);
    await prisma.refreshToken.deleteMany({ where: { token: hashed } });
  },

  async logoutAll(userId: string) {
    await prisma.refreshToken.deleteMany({ where: { userId } });
  },
};
