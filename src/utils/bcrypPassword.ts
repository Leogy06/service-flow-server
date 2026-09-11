import bcrypt from "bcryptjs";
import { env } from "@/config/env.js";

export function hashedPassword(password: string) {
  return bcrypt.hash(password, env.SALT_ROUNDS);
}

export function comparePassword(password: string, hashedPassword: string) {
  return bcrypt.compare(password, hashedPassword);
}
