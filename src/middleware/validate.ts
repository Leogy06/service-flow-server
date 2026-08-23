import { Request, Response, NextFunction } from "express";
import { ZodObject, ZodError } from "zod";
import { AppError } from "@/utils/AppError.js";

export function validate(schema: ZodObject) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      req.validated = {
        body: parsed.body ?? req.body,
        query: parsed.query ?? req.query,
        params: parsed.params ?? req.params,
      };

      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const message = err.issues
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ");

        return next(new AppError(400, message));
      }

      next(err);
    }
  };
}
