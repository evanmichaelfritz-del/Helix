import type { MiddlewareHandler } from "hono";
import type { Env } from "./context.js";
import type { Database } from "./db.js";

/**
 * Fixed window for every POST /api/auth/*.
 * Counters live in `auth_rate_limits` (SQLite locally, Neon on Vercel), one row per IP,
 * so they are shared across serverless instances rather than kept in process memory.
 */
export const AUTH_RATE_LIMIT = {
  limit: 10,
  windowMs: 60_000,
  error: "Too many attempts",
} as const;

const UNKNOWN_IP = "unknown";

export function clientIp(getHeader: (name: string) => string | undefined): string {
  const forwarded = getHeader("x-forwarded-for");
  if (forwarded !== undefined) {
    const first = forwarded.split(",")[0]?.trim() ?? "";
    const ip = canonicalIp(first);
    if (ip) return ip;
  }
  const real = getHeader("x-real-ip")?.trim();
  if (real) {
    const ip = canonicalIp(real);
    if (ip) return ip;
  }
  return UNKNOWN_IP;
}

export async function consumeAuthRateLimit(
  db: Database,
  ip: string,
  now = Date.now(),
): Promise<{ allowed: true } | { allowed: false; retryAfter: number }> {
  const { limit, windowMs } = AUTH_RATE_LIMIT;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const row = await db.get<{ hits: number | string | bigint }>(
    `INSERT INTO auth_rate_limits (ip, window_start, hits) VALUES (?, ?, 1)
     ON CONFLICT(ip) DO UPDATE SET
       window_start = excluded.window_start,
       hits = CASE
         WHEN auth_rate_limits.window_start <> excluded.window_start THEN 1
         WHEN auth_rate_limits.hits > ? THEN auth_rate_limits.hits
         ELSE auth_rate_limits.hits + 1
       END
     RETURNING hits`,
    [ip, windowStart, limit],
  );
  const hits = Number(row?.hits);
  if (!Number.isFinite(hits) || hits > limit) {
    return { allowed: false, retryAfter: retryAfterSeconds(now, windowStart, windowMs) };
  }
  return { allowed: true };
}

export const authRateLimit: MiddlewareHandler<Env> = async (c, next) => {
  if (c.req.method !== "POST") {
    await next();
    return;
  }
  const path = new URL(c.req.url).pathname;
  if (!path.startsWith("/api/auth/")) {
    await next();
    return;
  }
  const decision = await consumeAuthRateLimit(c.get("db"), clientIp((name) => c.req.header(name)));
  if (!decision.allowed) {
    c.header("Retry-After", String(decision.retryAfter));
    return c.json({ error: AUTH_RATE_LIMIT.error }, 429);
  }
  await next();
};

function retryAfterSeconds(now: number, windowStart: number, windowMs: number): number {
  const remainingMs = windowStart + windowMs - now;
  return Math.max(1, Math.ceil(remainingMs / 1000));
}

function canonicalIp(value: string): string | null {
  if (value.length === 0 || value.length > 64) return null;
  const v4 = canonicalIpv4(value);
  if (v4) return v4;
  if (isIpv6(value)) return value.toLowerCase();
  return null;
}

function canonicalIpv4(value: string): string | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    nums.push(n);
  }
  return nums.join(".");
}

function isIpv6(value: string): boolean {
  if (!value.includes(":") || value.includes("%")) return false;
  let rest = value;
  let hasV4 = false;
  if (rest.includes(".")) {
    const last = rest.lastIndexOf(":");
    if (last < 0 || !canonicalIpv4(rest.slice(last + 1))) return false;
    rest = rest.slice(0, last);
    hasV4 = true;
  }
  if (!/^[0-9a-fA-F:]*$/.test(rest)) return false;
  const halves = rest.split("::");
  if (halves.length > 2) return false;
  const parts = halves.flatMap((half) => (half === "" ? [] : half.split(":")));
  if (parts.some((part) => part.length === 0 || part.length > 4 || !/^[0-9a-fA-F]+$/.test(part))) return false;
  const max = hasV4 ? 6 : 8;
  if (halves.length === 1) return parts.length === max;
  return parts.length < max;
}
