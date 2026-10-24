import type { RequestHandler } from "express";
import { isIP } from "node:net";
import { timingSafeEqual } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";

export function matchesSecret(value: string | undefined, secret: string | undefined): boolean {
  if (!value || !secret) return false;
  const left = Buffer.from(value);
  const right = Buffer.from(secret);
  return left.length === right.length && timingSafeEqual(left, right);
}

const firstIp = (value: string | undefined) => {
  const ip = value?.split(",")[0]?.trim();
  return ip && isIP(ip) ? ip : undefined;
};
const truncate = (value: string, length: number) => Array.from(value).slice(0, length).join("");

export const accessLogger: RequestHandler = (req, res, next) => {
  const path = req.originalUrl.split("?")[0] ?? req.path;
  if (["/favicon.ico", "/api/health"].includes(path) ||
      /^\/api\/(?:admin|system-admin)(?:\/|$)/i.test(path) ||
      path.startsWith("/api/cron/")) return next();
  const started = performance.now();
  const internal = matchesSecret(req.get("x-internal-api-secret"), env.INTERNAL_API_SECRET);
  // Express applies the configured proxy trust boundary; raw forwarding headers
  // are attacker-controlled on direct origins and unsanitized proxy paths.
  const ip = (internal ? firstIp(req.get("x-client-ip")) : undefined) ??
    req.ip ?? req.socket.remoteAddress ?? "unknown";
  const country = req.get("x-vercel-ip-country");
  let city = req.get("x-vercel-ip-city");
  try { if (city) city = decodeURIComponent(city); } catch { /* Retain malformed city text safely. */ }
  // Capture only the allowed metadata. Query values can contain reset tokens.
  const data = {
    ip: truncate(ip, 45), method: truncate(req.method, 32), path: truncate(path, 500),
    country: country && /^[a-z]{2}$/i.test(country) ? country.toUpperCase() : null,
    city: city ? truncate(city, 255) : null,
    userAgent: req.get("user-agent") ? truncate(req.get("user-agent")!, 300) : null,
  };
  res.on("finish", () => {
    try {
      const durationMs = Math.min(2_147_483_647, Math.max(0, Math.round(performance.now() - started)));
      const task = Promise.resolve().then(() => prisma.accessLog.create({ data: {
        ...data, status: res.statusCode, durationMs,
      } })).catch(() => { console.error("Access log insert failed"); });
      waitUntil(task);
    } catch { console.error("Access log scheduling failed"); }
  });
  next();
};
