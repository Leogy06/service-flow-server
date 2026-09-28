import { Prisma } from "@/generated/prisma/client";

export function isPrismaError(err: unknown, code: string) {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === code
  );
}
