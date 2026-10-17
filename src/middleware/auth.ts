import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "@/utils/tokens";
import jwt from "jsonwebtoken";
import { AppError } from "@/utils/AppError"; // adjust to your actual path
import { requestContext } from "@/lib/requestContext";
import { loadAuthorization, sessionUser } from "@/modules/auth/authorization";

const { TokenExpiredError, JsonWebTokenError } = jwt;

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
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
    const user = await loadAuthorization(payload.sub);
    // Pre-migration JWTs represent version zero and stop working after revocation.
    if ((payload.sessionVersion ?? 0) !== user.sessionVersion) {
      throw new AppError(401, "Session is no longer valid", "SESSION_REVOKED");
    }
    req.user = sessionUser(user);

    const ctx = requestContext.get();
    if (ctx) {
      ctx.userId = req.user.id;
      ctx.role = req.user.role;
      ctx.organizationId = req.user.organizationId;
      ctx.permissions = req.user.permissions;
    }

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

export function requireRole(roles: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || roles !== req.user.role) {
      return next(new AppError(403, "Forbidden"));
    }
    next();
  };
}
