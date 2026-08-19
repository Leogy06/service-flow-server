import { Request, Response, NextFunction } from "express";
import { Role } from "@/generated/prisma/client.js";
import { verifyAccessToken } from "@/utils/tokens.js";
import jwt from "jsonwebtoken";
import { AppError } from "@/utils/AppError.js"; // adjust to your actual path

const { TokenExpiredError, JsonWebTokenError } = jwt;

export function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.split(" ")[1]
    : null;

  // console.log("authHeader:", req.headers);
  // console.log("token:", token);

  if (!token) {
    return next(new AppError(401, "No token provided"));
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch (err: unknown) {
    if (err instanceof TokenExpiredError) {
      return next(new AppError(401, "Token expired", "TOKEN_EXPIRED"));
    }
    if (err instanceof JsonWebTokenError) {
      return next(new AppError(401, "Invalid token", "INVALID_TOKEN"));
    }
    next(err);
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError(403, "Forbidden"));
    }
    next();
  };
}
