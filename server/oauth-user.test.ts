import { describe, expect, it } from "vitest";
import { createSqliteDb, migrate } from "./db.js";
import { insertIdentity, linkOrCreateOAuthUser } from "./oauth-user.js";
import { DEFAULT_SETTINGS } from "../shared/types.js";

async function seed() {
  const db = await createSqliteDb(":memory:");
  await migrate(db);
  return db;
}

describe("oauth link-or-create", () => {
  it("links a verified Google email onto an existing password user", async () => {
    const db = await seed();
    await db.run(
      "INSERT INTO users (id, email, password_hash, display_name, settings, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["u1", "evan@example.com", "hash", null, JSON.stringify(DEFAULT_SETTINGS), new Date().toISOString()],
    );
    await insertIdentity(db, "u1", "password", "u1");
    const first = await linkOrCreateOAuthUser(db, {
      provider: "google",
      providerUserId: "g-1",
      email: "evan@example.com",
      emailVerified: true,
      displayName: "Evan",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.created).toBe(false);
    expect(first.user.id).toBe("u1");
    expect(first.user.password_hash).toBe("hash");
    const second = await linkOrCreateOAuthUser(db, {
      provider: "google",
      providerUserId: "g-1",
      email: "other@example.com",
      emailVerified: true,
      displayName: "Evan",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.user.id).toBe("u1");
    const identities = await db.all<{ provider: string }>("SELECT provider FROM identities WHERE user_id = ?", ["u1"]);
    expect(identities.map((row) => row.provider).sort()).toEqual(["google", "password"]);
  });

  it("creates an OAuth user with a nullable password_hash and no dummy hash", async () => {
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
  });

  it("does not merge X onto a password user without email", async () => {
    const db = await seed();
    await db.run(
      "INSERT INTO users (id, email, password_hash, display_name, settings, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["u1", "evan@example.com", "hash", null, JSON.stringify(DEFAULT_SETTINGS), new Date().toISOString()],
    );
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
    expect(x.user.password_hash).toBeNull();
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
    await db.run(
      "INSERT INTO users (id, email, password_hash, display_name, settings, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["u1", "a@example.com", "hash", null, "{}", new Date().toISOString()],
    );
    await db.run(
      "INSERT INTO users (id, email, password_hash, display_name, settings, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["u2", "b@example.com", "hash", null, "{}", new Date().toISOString()],
    );
    await insertIdentity(db, "u1", "google", "g-dup");
    await expect(insertIdentity(db, "u2", "google", "g-dup")).rejects.toThrow();
  });
});
