import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { env } from "@/config/env.js";
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// log env
// console.log("env", env);

const adapter = new PrismaMariaDb({
  host: env.DATABASE_HOST ?? "localhost",
  port: Number(env.DATABASE_PORT ?? 3306),
  user: env.DATABASE_USER,
  password: env.DATABASE_PASSWORD,
  database: env.DATABASE_NAME,
  allowPublicKeyRetrieval: env.NODE_ENV === "development",
  connectionLimit: 5,
});

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log:
      env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
