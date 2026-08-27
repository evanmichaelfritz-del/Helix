import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { decodeIdToken, generateCodeVerifier, generateState, Google, Twitter } from "arctic";
import { createSession } from "../auth.js";
import type { AppContext, Env } from "../context.js";
import { linkOrCreateOAuthUser, type OAuthProfile } from "../oauth-user.js";
import { appOrigin } from "../origin.js";

export const OAUTH_COOKIE = "helix_oauth";
const OAUTH_MINUTES = 10;

export const oauthRoutes = new Hono<Env>();

oauthRoutes.get("/google", (c) => startOAuth(c, "google"));
oauthRoutes.get("/google/callback", (c) => handleCallback(c, "google"));
oauthRoutes.get("/x", (c) => startOAuth(c, "x"));
oauthRoutes.get("/x/callback", (c) => handleCallback(c, "x"));

function missingMessage(provider: "google" | "x"): string {
  return provider === "google" ? "Google sign-in isn't configured." : "X sign-in isn't configured.";
}

function redirectHome(c: AppContext, created: boolean, error?: string): Response {
  const origin = appOrigin(c);
  const url = new URL(origin);
  if (error) url.searchParams.set("auth_error", error);
  else if (created) url.searchParams.set("new", "1");
  return c.redirect(url.toString());
}

export function packOAuthCookie(provider: "google" | "x", state: string, verifier: string): string {
  return encodeURIComponent(JSON.stringify({ provider, state, verifier }));
}

export function unpackOAuthCookie(
  raw: string,
): { provider: "google" | "x"; state: string; verifier: string } | null {
  try {
    let text = raw;
    try {
      const parsed: unknown = JSON.parse(text);
      if (isPacked(parsed)) return parsed;
    } catch {
      text = decodeURIComponent(raw);
    }
    const parsed: unknown = JSON.parse(text);
    return isPacked(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPacked(
  value: unknown,
): value is { provider: "google" | "x"; state: string; verifier: string } {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    (obj.provider === "google" || obj.provider === "x") &&
    typeof obj.state === "string" &&
    typeof obj.verifier === "string"
  );
}

function oauthClients(c: AppContext, provider: "google" | "x") {
  const origin = appOrigin(c);
  if (provider === "google") {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) return { ok: false as const, error: missingMessage("google") };
    return {
      ok: true as const,
      client: new Google(clientId, clientSecret, `${origin}/api/auth/google/callback`),
      scopes: ["openid", "email", "profile"],
    };
  }
  const clientId = process.env.X_CLIENT_ID?.trim();
  const clientSecret = process.env.X_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return { ok: false as const, error: missingMessage("x") };
  return {
    ok: true as const,
    client: new Twitter(clientId, clientSecret, `${origin}/api/auth/x/callback`),
    scopes: ["users.read", "tweet.read"],
  };
}

function startOAuth(c: AppContext, provider: "google" | "x"): Response {
  const ready = oauthClients(c, provider);
  if (!ready.ok) return redirectHome(c, false, ready.error);
  const state = generateState();
  const verifier = generateCodeVerifier();
  const url = ready.client.createAuthorizationURL(state, verifier, ready.scopes);
  setCookie(c, OAUTH_COOKIE, packOAuthCookie(provider, state, verifier), {
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure: Boolean(process.env.VERCEL),
    maxAge: OAUTH_MINUTES * 60,
  });
  return c.redirect(url.toString());
}

async function handleCallback(c: AppContext, provider: "google" | "x"): Promise<Response> {
  const denied = c.req.query("error");
  if (denied) {
    deleteCookie(c, OAUTH_COOKIE, { path: "/" });
    return redirectHome(c, false, "Sign-in was cancelled.");
  }
  const packed = getCookie(c, OAUTH_COOKIE);
  deleteCookie(c, OAUTH_COOKIE, { path: "/" });
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!packed || !code || !state) return redirectHome(c, false, "Sign-in expired. Try again.");
  const cookie = unpackOAuthCookie(packed);
  if (!cookie || cookie.provider !== provider || cookie.state !== state) {
    return redirectHome(c, false, "Sign-in expired. Try again.");
  }
  const ready = oauthClients(c, provider);
  if (!ready.ok) return redirectHome(c, false, ready.error);
  try {
    const tokens = await ready.client.validateAuthorizationCode(code, cookie.verifier);
    const profile =
      provider === "google" ? googleProfile(tokens.idToken()) : await xProfile(tokens.accessToken());
    if (!profile.ok) return redirectHome(c, false, profile.error);
    const linked = await linkOrCreateOAuthUser(c.get("db"), profile.profile, c.get("user"));
    if (!linked.ok) return redirectHome(c, false, linked.error);
    await createSession(c, linked.user.id);
    return redirectHome(c, linked.created);
  } catch (err) {
    console.error(err);
    return redirectHome(c, false, "Could not finish sign-in.");
  }
}

function googleProfile(idToken: string): { ok: true; profile: OAuthProfile } | { ok: false; error: string } {
  const claims = decodeIdToken(idToken) as Record<string, unknown>;
  const sub = typeof claims.sub === "string" ? claims.sub : "";
  const email = typeof claims.email === "string" ? claims.email : null;
  const verified = claims.email_verified === true || claims.email_verified === "true";
  const name = typeof claims.name === "string" ? claims.name : null;
  if (!sub) return { ok: false, error: "Could not finish sign-in." };
  return {
    ok: true,
    profile: {
      provider: "google",
      providerUserId: sub,
      email,
      emailVerified: verified,
      displayName: name,
    },
  };
}

async function xProfile(
  accessToken: string,
): Promise<{ ok: true; profile: OAuthProfile } | { ok: false; error: string }> {
  const res = await fetch("https://api.x.com/2/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const fallback = await fetch("https://api.twitter.com/2/users/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!fallback.ok) return { ok: false, error: "Could not finish sign-in." };
    return parseXUser(await fallback.json());
  }
  return parseXUser(await res.json());
}

function parseXUser(body: unknown): { ok: true; profile: OAuthProfile } | { ok: false; error: string } {
  const data =
    body && typeof body === "object" && "data" in body && body.data && typeof body.data === "object"
      ? (body.data as Record<string, unknown>)
      : null;
  const id = data && typeof data.id === "string" ? data.id : "";
  if (!id) return { ok: false, error: "Could not finish sign-in." };
  const name = data && typeof data.name === "string" ? data.name : null;
  const username = data && typeof data.username === "string" ? data.username : null;
  return {
    ok: true,
    profile: {
      provider: "x",
      providerUserId: id,
      email: null,
      emailVerified: false,
      displayName: name ?? username,
    },
  };
}
