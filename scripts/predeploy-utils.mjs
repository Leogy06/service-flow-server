import { createServer } from "node:net";

export function assertLocalServices(env) {
  const local = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  const database = new URL(env.DATABASE_URL);
  const redis = new URL(env.REDIS_URL ?? "redis://localhost:6379");
  if (database.protocol !== "mysql:" || !local.has(database.hostname) ||
      !local.has(env.DATABASE_HOST) || !["redis:", "rediss:"].includes(redis.protocol) ||
      !local.has(redis.hostname)) {
    throw new Error("Local probes require loopback MySQL and Redis addresses. Remote services are never probed.");
  }
  if (decodeURIComponent(database.pathname.slice(1)) !== env.DATABASE_NAME ||
      Number(database.port || 3306) !== Number(env.DATABASE_PORT || 3306) ||
      decodeURIComponent(database.username) !== env.DATABASE_USER ||
      decodeURIComponent(database.password) !== env.DATABASE_PASSWORD) {
    throw new Error("DATABASE_URL and runtime DATABASE_* settings must target the same local database and credentials.");
  }
}

export function createRedactor(env) {
  const secrets = new Set(Object.entries(env)
    .filter(([key, value]) => value && /(?:PASSWORD|SECRET|API_KEY)$/.test(key))
    .flatMap(([, value]) => [value, encodeURIComponent(value)]));
  for (const key of ["DATABASE_URL", "REDIS_URL"]) {
    try {
      const url = new URL(env[key]);
      if (url.password) {
        secrets.add(url.password);
        secrets.add(decodeURIComponent(url.password));
      }
    } catch { /* Missing or invalid URLs are reported by environment checks. */ }
  }
  return {
    add: (secret) => { secrets.add(secret); secrets.add(encodeURIComponent(secret)); },
    redact: (value) => [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)
      .reduce((text, secret) => text.split(secret).join("[REDACTED]"), String(value))
      .replace(/\b((?:mysql|rediss?):\/\/)[^\s/@]*@/gi, "$1[REDACTED]@"),
  };
}

export function resultExitCode(results) {
  if (results.some(({ status }) => status === "FAIL")) return 1;
  return results.some(({ status }) => status === "BLOCKED") ? 2 : 0;
}

export async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}
