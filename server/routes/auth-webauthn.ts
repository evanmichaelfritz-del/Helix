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
        userName: user.email ?? user.display_name ?? user.id,
        userDisplayName: user.display_name ?? user.email ?? user.id,
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
    const { kind, response: rawResponse } = c.req.valid("json");
    const db = c.get("db");
    if (kind === "register") {
      const response = parseRegistrationResponse(rawResponse);
      if (!response) return c.json({ error: "Passkey could not be verified." }, 400);
      const challenge = challengeFromClientData(response);
      if (!challenge) return c.json({ error: "Passkey could not be verified." }, 400);
      const pending = await db.get<{ id: string; user_id: string | null; challenge: string }>(
        "SELECT id, user_id, challenge FROM webauthn_challenges WHERE challenge = ? AND kind = ? AND expires_at > ?",
        [challenge, kind, new Date().toISOString()],
      );
      if (!pending) return c.json({ error: "Passkey sign-in expired. Try again." }, 400);
      const user = c.get("user");
      if (!user || pending.user_id !== user.id) return c.json({ error: "unauthorized" }, 401);
      const verified = await verifyRegistrationResponse({
        response,
        expectedChallenge: pending.challenge,
        expectedOrigin: webauthnOrigins(),
        expectedRPID: webauthnRpId(),
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

    const response = parseAuthenticationResponse(rawResponse);
    if (!response) return c.json({ error: "Passkey could not be verified." }, 400);
    const challenge = challengeFromClientData(response);
    if (!challenge) return c.json({ error: "Passkey could not be verified." }, 400);
    const pending = await db.get<{ id: string; user_id: string | null; challenge: string }>(
      "SELECT id, user_id, challenge FROM webauthn_challenges WHERE challenge = ? AND kind = ? AND expires_at > ?",
      [challenge, kind, new Date().toISOString()],
    );
    if (!pending) return c.json({ error: "Passkey sign-in expired. Try again." }, 400);
    const stored = await db.get<CredentialRow>(
      "SELECT id, user_id, credential_id, public_key, counter, transports FROM webauthn_credentials WHERE credential_id = ?",
      [response.id],
    );
    if (!stored) return c.json({ error: "Passkey could not be verified." }, 400);
    const verified = await verifyAuthenticationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: webauthnOrigins(),
      expectedRPID: webauthnRpId(),
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

function parseRegistrationResponse(raw: unknown): RegistrationResponseJSON | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.rawId !== "string") return null;
  if (o.type !== undefined && o.type !== "public-key") return null;
  if (!o.response || typeof o.response !== "object") return null;
  const resp = o.response as Record<string, unknown>;
  if (typeof resp.clientDataJSON !== "string" || typeof resp.attestationObject !== "string") return null;
  const parsed: RegistrationResponseJSON = {
    id: o.id,
    rawId: o.rawId,
    type: "public-key",
    response: {
      clientDataJSON: resp.clientDataJSON,
      attestationObject: resp.attestationObject,
    },
    clientExtensionResults:
      o.clientExtensionResults && typeof o.clientExtensionResults === "object"
        ? (o.clientExtensionResults as RegistrationResponseJSON["clientExtensionResults"])
        : {},
  };
  return parsed;
}

function parseAuthenticationResponse(raw: unknown): AuthenticationResponseJSON | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.rawId !== "string") return null;
  if (o.type !== undefined && o.type !== "public-key") return null;
  if (!o.response || typeof o.response !== "object") return null;
  const resp = o.response as Record<string, unknown>;
  if (
    typeof resp.clientDataJSON !== "string" ||
    typeof resp.authenticatorData !== "string" ||
    typeof resp.signature !== "string"
  ) {
    return null;
  }
  const parsed: AuthenticationResponseJSON = {
    id: o.id,
    rawId: o.rawId,
    type: "public-key",
    response: {
      clientDataJSON: resp.clientDataJSON,
      authenticatorData: resp.authenticatorData,
      signature: resp.signature,
      ...(typeof resp.userHandle === "string" ? { userHandle: resp.userHandle } : {}),
    },
    clientExtensionResults:
      o.clientExtensionResults && typeof o.clientExtensionResults === "object"
        ? (o.clientExtensionResults as AuthenticationResponseJSON["clientExtensionResults"])
        : {},
  };
  return parsed;
}

function challengeFromClientData(response: { response: { clientDataJSON: string } }): string | null {
  try {
    const json = JSON.parse(isoBase64URL.toUTF8String(response.response.clientDataJSON)) as {
      challenge?: unknown;
    };
    return typeof json.challenge === "string" ? json.challenge : null;
  } catch {
    return null;
  }
}
