import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticatorTransportFuture,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { createSession, newId } from "../auth.js";
import type { Env, UserRow } from "../context.js";
import { toPublicUser } from "../context.js";
import type { Database } from "../db.js";
import { webauthnOrigins, webauthnRpId } from "../origin.js";

const USER_COLS = "id, email, password_hash, display_name, settings, created_at";
const CHALLENGE_MS = 5 * 60 * 1000;

type CredentialRow = {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
};

export const webauthnRoutes = new Hono<Env>();

webauthnRoutes.post(
  "/passkey/options",
  zValidator("json", z.object({ kind: z.enum(["register", "authenticate"]) })),
  async (c) => {
    const { kind } = c.req.valid("json");
    const db = c.get("db");
    const rpID = webauthnRpId();
    await db.run("DELETE FROM webauthn_challenges WHERE expires_at <= ?", [new Date().toISOString()]);

    if (kind === "register") {
      const user = c.get("user");
      if (!user) return c.json({ error: "unauthorized" }, 401);
      const existing = await db.all<CredentialRow>(
        "SELECT id, user_id, credential_id, public_key, counter, transports FROM webauthn_credentials WHERE user_id = ?",
        [user.id],
      );
      const options = await generateRegistrationOptions({
        rpName: "Helix",
        rpID,
        userName: user.email,
        userDisplayName: user.display_name ?? user.email,
        userID: new TextEncoder().encode(user.id),
        attestationType: "none",
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          residentKey: "required",
          requireResidentKey: true,
          userVerification: "required",
        },
        excludeCredentials: existing.map((row) => ({
          id: row.credential_id,
          transports: parseTransports(row.transports),
        })),
      });
      await storeChallenge(db, options.challenge, "register", user.id);
      return c.json({ options });
    }

    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "required",
    });
    await storeChallenge(db, options.challenge, "authenticate", null);
    return c.json({ options });
  },
);

webauthnRoutes.post(
  "/passkey/verify",
  zValidator(
    "json",
    z.object({
      kind: z.enum(["register", "authenticate"]),
      response: z.unknown(),
    }),
  ),
  async (c) => {
    const { kind, response } = c.req.valid("json");
    const db = c.get("db");
    const challenge = challengeFromClientData(response);
    if (!challenge) return c.json({ error: "Passkey could not be verified." }, 400);
    const pending = await db.get<{ id: string; user_id: string | null; challenge: string }>(
      "SELECT id, user_id, challenge FROM webauthn_challenges WHERE challenge = ? AND kind = ? AND expires_at > ?",
      [challenge, kind, new Date().toISOString()],
    );
    if (!pending) return c.json({ error: "Passkey sign-in expired. Try again." }, 400);

    const expectedOrigin = webauthnOrigins();
    const expectedRPID = webauthnRpId();

    if (kind === "register") {
      const user = c.get("user");
      if (!user || pending.user_id !== user.id) return c.json({ error: "unauthorized" }, 401);
      const verified = await verifyRegistrationResponse({
        response: response as RegistrationResponseJSON,
        expectedChallenge: pending.challenge,
        expectedOrigin,
        expectedRPID,
        requireUserVerification: true,
      });
      if (!verified.verified || !verified.registrationInfo) {
        return c.json({ error: "Passkey could not be verified." }, 400);
      }
      const cred = verified.registrationInfo.credential;
      await db.run(
        "INSERT INTO webauthn_credentials (id, user_id, credential_id, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          newId(),
          user.id,
          cred.id,
          isoBase64URL.fromBuffer(cred.publicKey),
          cred.counter,
          JSON.stringify(cred.transports ?? []),
          new Date().toISOString(),
        ],
      );
      await db.run("DELETE FROM webauthn_challenges WHERE id = ?", [pending.id]);
      return c.json({ ok: true, user: toPublicUser(user) });
    }

    const assertion = response as { id?: unknown };
    const credentialId = typeof assertion.id === "string" ? assertion.id : "";
    const stored = await db.get<CredentialRow>(
      "SELECT id, user_id, credential_id, public_key, counter, transports FROM webauthn_credentials WHERE credential_id = ?",
      [credentialId],
    );
    if (!stored) return c.json({ error: "Passkey could not be verified." }, 400);
    const verified = await verifyAuthenticationResponse({
      response: response as AuthenticationResponseJSON,
      expectedChallenge: pending.challenge,
      expectedOrigin,
      expectedRPID,
      requireUserVerification: true,
      credential: {
        id: stored.credential_id,
        publicKey: isoBase64URL.toBuffer(stored.public_key),
        counter: Number(stored.counter),
        transports: parseTransports(stored.transports),
      },
    });
    if (!verified.verified) return c.json({ error: "Passkey could not be verified." }, 400);
    await db.run("UPDATE webauthn_credentials SET counter = ? WHERE id = ?", [
      verified.authenticationInfo.newCounter,
      stored.id,
    ]);
    await db.run("DELETE FROM webauthn_challenges WHERE id = ?", [pending.id]);
    const user = await db.get<UserRow>(`SELECT ${USER_COLS} FROM users WHERE id = ?`, [stored.user_id]);
    if (!user) return c.json({ error: "Passkey could not be verified." }, 400);
    await createSession(c, user.id);
    return c.json({ user: toPublicUser(user) });
  },
);

async function storeChallenge(
  db: Database,
  challenge: string,
  kind: "register" | "authenticate",
  userId: string | null,
): Promise<void> {
  const expires = new Date(Date.now() + CHALLENGE_MS).toISOString();
  await db.run(
    "INSERT INTO webauthn_challenges (id, user_id, challenge, kind, expires_at) VALUES (?, ?, ?, ?, ?)",
    [newId(), userId, challenge, kind, expires],
  );
}

function parseTransports(raw: string | null): AuthenticatorTransportFuture[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const allowed: AuthenticatorTransportFuture[] = [
      "ble",
      "cable",
      "hybrid",
      "internal",
      "nfc",
      "smart-card",
      "usb",
    ];
    return parsed.filter((item): item is AuthenticatorTransportFuture =>
      typeof item === "string" && allowed.includes(item as AuthenticatorTransportFuture),
    );
  } catch {
    return undefined;
  }
}

function challengeFromClientData(response: unknown): string | null {
  if (!response || typeof response !== "object" || !("response" in response)) return null;
  const inner = (response as { response?: { clientDataJSON?: unknown } }).response;
  const raw = inner?.clientDataJSON;
  if (typeof raw !== "string") return null;
  try {
    const json = JSON.parse(isoBase64URL.toUTF8String(raw)) as { challenge?: unknown };
    return typeof json.challenge === "string" ? json.challenge : null;
  } catch {
    return null;
  }
}
