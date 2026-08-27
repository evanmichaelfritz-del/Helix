import type { AppContext } from "./context.js";

export const PROD_ORIGIN = "https://helix-green-one.vercel.app";
export const PROD_RP_ID = "helix-green-one.vercel.app";

const LOCAL_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

export function appOrigin(_c: AppContext): string {
  const configured = process.env.APP_ORIGIN?.trim().replace(/\/$/, "");
  if (configured) return configured;
  if (process.env.VERCEL) return PROD_ORIGIN;
  return "http://localhost:5173";
}

export function webauthnRpId(): string {
  const configured = process.env.WEBAUTHN_RP_ID?.trim();
  if (configured) return configured;
  return process.env.VERCEL ? PROD_RP_ID : "localhost";
}

export function webauthnOrigins(): string[] {
  const extra = process.env.APP_ORIGIN?.trim().replace(/\/$/, "");
  if (webauthnRpId() === PROD_RP_ID) {
    const origins = new Set<string>([PROD_ORIGIN]);
    if (extra && !isLocalOrigin(extra)) origins.add(extra);
    return [...origins];
  }
  const origins = new Set<string>(LOCAL_ORIGINS);
  if (extra) origins.add(extra);
  return [...origins];
}

function isLocalOrigin(origin: string): boolean {
  return LOCAL_ORIGINS.includes(origin) || origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1");
}

export function mailerConfigured(): boolean {
  return Boolean(
    process.env.MAIL_FROM && (process.env.SMTP_URL || process.env.RESEND_API_KEY),
  );
}
