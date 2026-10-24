import type { MiddlewareHandler } from "hono";
import type { Env } from "./context.js";
import type { Database } from "./db.js";

/**
 * Fixed window for POST /api/auth/* except logout.
 * Counters live in `auth_rate_limits` (SQLite locally, Neon on Vercel), one row per IP,
 * so they are shared across serverless instances rather than kept in process memory.
 * IPv6 keys are the /64 (first four hextets).
 */
export const AUTH_RATE_LIMIT = {
  limit: 10,
  windowMs: 60_000,
  error: "Too many attempts",
} as const;

const UNKNOWN_IP = "unknown";
const PRUNE_SAMPLE = 0.01;

export function clientIp(getHeader: (name: string) => string | undefined): string {
  // Prefer x-vercel-forwarded-for, then the first X-Forwarded-For hop, then x-real-ip.
  // A spoofed XFF can bypass the limit only off Vercel, because Vercel's edge overwrites these headers.
  return (
    headerIp(getHeader("x-vercel-forwarded-for")) ??
    headerIp(getHeader("x-forwarded-for")) ??
    headerIp(getHeader("x-real-ip")) ??
    UNKNOWN_IP
  );
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
       hits = CASE
         WHEN excluded.window_start > auth_rate_limits.window_start THEN 1
         WHEN auth_rate_limits.hits > ? THEN auth_rate_limits.hits
         ELSE auth_rate_limits.hits + 1
       END,
       window_start = CASE
         WHEN excluded.window_start > auth_rate_limits.window_start THEN excluded.window_start
         ELSE auth_rate_limits.window_start
       END
     RETURNING hits`,
    [ip, windowStart, limit],
  );
  if (Math.random() < PRUNE_SAMPLE) {
    await db.run("DELETE FROM auth_rate_limits WHERE window_start < ?", [now - windowMs]);
  }
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
  if (!path.startsWith("/api/auth/") || path === "/api/auth/logout") {
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

function headerIp(value: string | undefined): string | null {
  if (value === undefined) return null;
  const first = value.split(",")[0]?.trim() ?? "";
  return canonicalIp(first);
}

function canonicalIp(value: string): string | null {
  let text = value.trim();
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone).trim();
  if (text.length === 0 || text.length > 64) return null;
  const v4 = canonicalIpv4(text);
  if (v4) return v4;
  const v6 = parseIpv6(text);
  if (!v6) return null;
  if (v6[0] === 0 && v6[1] === 0 && v6[2] === 0 && v6[3] === 0 && v6[4] === 0 && v6[5] === 0xffff) {
    return `${v6[6] >> 8}.${v6[6] & 0xff}.${v6[7] >> 8}.${v6[7] & 0xff}`;
  }
  return `${v6[0].toString(16)}:${v6[1].toString(16)}:${v6[2].toString(16)}:${v6[3].toString(16)}`;
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

function parseIpv6(value: string): number[] | null {
  if (!value.includes(":")) return null;
  const halves = value.split("::");
  if (halves.length > 2) return null;
  if (halves.length === 1) {
    const full = parseIpv6Side(halves[0], true);
    return full && full.length === 8 ? full : null;
  }
  const left = parseIpv6Side(halves[0], false);
  const right = parseIpv6Side(halves[1], true);
  if (!left || !right || left.length + right.length >= 8) return null;
  return [...left, ...new Array<number>(8 - left.length - right.length).fill(0), ...right];
}

function parseIpv6Side(side: string, allowV4: boolean): number[] | null {
  if (side === "") return [];
  const bits = side.split(":");
  const out: number[] = [];
  for (let i = 0; i < bits.length; i++) {
    const bit = bits[i].toLowerCase();
    if (i === bits.length - 1 && bit.includes(".")) {
      if (!allowV4) return null;
      const v4 = canonicalIpv4(bit);
      if (!v4) return null;
      const [a, b, c, d] = v4.split(".").map(Number);
      out.push((a << 8) | b, (c << 8) | d);
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/.test(bit)) return null;
    out.push(Number.parseInt(bit, 16));
  }
  return out;
}
