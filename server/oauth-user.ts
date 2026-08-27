import { newId } from "./auth.js";
import type { UserRow } from "./context.js";
import type { Database } from "./db.js";
import { DEFAULT_SETTINGS } from "../shared/types.js";

export type OAuthProvider = "google" | "x";

export type OAuthProfile = {
  provider: OAuthProvider;
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
};

export type LinkResult =
  | { ok: true; user: UserRow; created: boolean }
  | { ok: false; error: string };

const USER_COLS = "id, email, password_hash, display_name, settings, created_at";

export async function insertIdentity(
  db: Database,
  userId: string,
  provider: string,
  providerUserId: string,
): Promise<void> {
  await db.run(
    "INSERT INTO identities (id, user_id, provider, provider_user_id, created_at) VALUES (?, ?, ?, ?, ?)",
    [newId(), userId, provider, providerUserId, new Date().toISOString()],
  );
}

export async function linkOrCreateOAuthUser(db: Database, profile: OAuthProfile): Promise<LinkResult> {
  const identity = await db.get<{ user_id: string }>(
    "SELECT user_id FROM identities WHERE provider = ? AND provider_user_id = ?",
    [profile.provider, profile.providerUserId],
  );
  if (identity) {
    const user = await db.get<UserRow>(`SELECT ${USER_COLS} FROM users WHERE id = ?`, [identity.user_id]);
    if (!user) return { ok: false, error: "Account is missing." };
    return { ok: true, user, created: false };
  }

  if (profile.provider === "google") {
    if (!profile.email || !profile.emailVerified) {
      return { ok: false, error: "Google sign-in needs a verified email." };
    }
    const email = profile.email.trim().toLowerCase();
    const existing = await db.get<UserRow>(`SELECT ${USER_COLS} FROM users WHERE email = ?`, [email]);
    if (existing) {
      await insertIdentity(db, existing.id, profile.provider, profile.providerUserId);
      return { ok: true, user: existing, created: false };
    }
    const user = await createOAuthUser(db, {
      email,
      displayName: profile.displayName,
    });
    await insertIdentity(db, user.id, profile.provider, profile.providerUserId);
    return { ok: true, user, created: true };
  }

  // X: identify only by provider_user_id. Never merge onto a password user by email.
  const email = `x-${profile.providerUserId}@oauth.invalid`;
  const user = await createOAuthUser(db, {
    email,
    displayName: profile.displayName,
  });
  await insertIdentity(db, user.id, profile.provider, profile.providerUserId);
  return { ok: true, user, created: true };
}

async function createOAuthUser(
  db: Database,
  opts: { email: string; displayName: string | null },
): Promise<UserRow> {
  const user: UserRow = {
    id: newId(),
    email: opts.email,
    password_hash: null,
    display_name: opts.displayName,
    settings: JSON.stringify(DEFAULT_SETTINGS),
    created_at: new Date().toISOString(),
  };
  await db.run(
    "INSERT INTO users (id, email, password_hash, display_name, settings, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [user.id, user.email, user.password_hash, user.display_name, user.settings, user.created_at],
  );
  return user;
}
