import { describe, expect, it } from "vitest";
import { createSqliteDb, migrate } from "./db.js";
import { insertIdentity, linkOrCreateOAuthUser } from "./oauth-user.js";
import type { UserRow } from "./context.js";
import { DEFAULT_SETTINGS } from "../shared/types.js";

async function seed() {
  const db = await createSqliteDb(":memory:");
  await migrate(db);
  return db;
}

async function passwordUser(db: Awaited<ReturnType<typeof seed>>, id = "u1", email = "evan@example.com") {
  await db.run(
    "INSERT INTO users (id, email, password_hash, display_name, settings, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [id, email, "hash", null, JSON.stringify(DEFAULT_SETTINGS), new Date().toISOString()],
  );
  await insertIdentity(db, id, "password", id);
  const user = await db.get<UserRow>(
    "SELECT id, email, password_hash, display_name, settings, created_at FROM users WHERE id = ?",
    [id],
  );
  if (!user) throw new Error("missing user");
  return user;
}

describe("oauth link-or-create", () => {
  it("fail-closes anonymous Google when that email is already taken", async () => {
    const db = await seed();
    await passwordUser(db);
    const result = await linkOrCreateOAuthUser(db, {
      provider: "google",
      providerUserId: "g-1",
      email: "evan@example.com",
      emailVerified: true,
      displayName: "Evan",
    });
    expect(result.ok).toBe(false);
    const identities = await db.all<{ provider: string }>("SELECT provider FROM identities WHERE provider = ?", [
      "google",
    ]);
    expect(identities).toEqual([]);
  });

  it("links Google onto the logged-in user only", async () => {
    const db = await seed();
    const sessionUser = await passwordUser(db);
    const first = await linkOrCreateOAuthUser(
      db,
      {
        provider: "google",
        providerUserId: "g-1",
        email: "evan@example.com",
        emailVerified: true,
        displayName: "Evan",
      },
      sessionUser,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.created).toBe(false);
    expect(first.user.id).toBe("u1");
    const identities = await db.all<{ provider: string }>("SELECT provider FROM identities WHERE user_id = ?", ["u1"]);
    expect(identities.map((row) => row.provider).sort()).toEqual(["google", "password"]);
  });

  it("creates a Google user when the email is free", async () => {
    const db = await seed();
    const created = await linkOrCreateOAuthUser(db, {
      provider: "google",
      providerUserId: "g-2",
      email: "new@example.com",
      emailVerified: true,
      displayName: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.created).toBe(true);
    expect(created.user.password_hash).toBeNull();
    expect(created.user.email).toBe("new@example.com");
  });

  it("creates X users with null email and never a synthetic address", async () => {
    const db = await seed();
    await passwordUser(db);
    const x = await linkOrCreateOAuthUser(db, {
      provider: "x",
      providerUserId: "x-9",
      email: "evan@example.com",
      emailVerified: true,
      displayName: "Evan",
    });
    expect(x.ok).toBe(true);
    if (!x.ok) return;
    expect(x.created).toBe(true);
    expect(x.user.id).not.toBe("u1");
    expect(x.user.email).toBeNull();
    expect(x.user.password_hash).toBeNull();
    expect(JSON.stringify(x.user)).not.toMatch(/oauth\.invalid/);
    const again = await linkOrCreateOAuthUser(db, {
      provider: "x",
      providerUserId: "x-9",
      email: null,
      emailVerified: false,
      displayName: "Evan",
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.user.id).toBe(x.user.id);
  });

  it("rejects unverified Google email", async () => {
    const db = await seed();
    const result = await linkOrCreateOAuthUser(db, {
      provider: "google",
      providerUserId: "g-3",
      email: "evan@example.com",
      emailVerified: false,
      displayName: null,
    });
    expect(result.ok).toBe(false);
  });

  it("keeps provider user ids unique across Helix users", async () => {
    const db = await seed();
    await passwordUser(db, "u1", "a@example.com");
    await passwordUser(db, "u2", "b@example.com");
    await insertIdentity(db, "u1", "google", "g-dup");
    await expect(insertIdentity(db, "u2", "google", "g-dup")).rejects.toThrow();
  });
});
