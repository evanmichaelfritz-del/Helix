import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
} = vi.hoisted(() => ({
  generateRegistrationOptions: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
}));

import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { createApp } from "./app.js";
import { createSqliteDb, migrate } from "./db.js";

async function testApp() {
  const db = await createSqliteDb(":memory:");
  await migrate(db);
  return { app: createApp(db), db };
}

async function signup(app: ReturnType<typeof createApp>, email = "evan@example.com") {
  const res = await app.request("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password12" }),
  });
  const cookie = res.headers.get("set-cookie") ?? "";
  expect(res.status).toBe(201);
  return cookie.split(";")[0];
}

function assertion(challenge: string, id: string) {
  return {
    id,
    rawId: id,
    type: "public-key",
    response: {
      clientDataJSON: isoBase64URL.fromUTF8String(
        JSON.stringify({ type: "webauthn.get", challenge, origin: "http://localhost:5173" }),
      ),
      authenticatorData: "AA",
      signature: "AA",
    },
  };
}

describe("passkey register and login", () => {
  beforeEach(() => {
    generateRegistrationOptions.mockReset();
    generateAuthenticationOptions.mockReset();
    verifyRegistrationResponse.mockReset();
    verifyAuthenticationResponse.mockReset();
  });

  it("registers a passkey then logs in with createSession", async () => {
    const { app } = await testApp();
    const cookie = await signup(app);

    generateRegistrationOptions.mockResolvedValue({
      challenge: "reg-chal",
      rp: { name: "Helix", id: "localhost" },
      user: { id: "dXNlcg", name: "evan@example.com", displayName: "evan@example.com" },
      pubKeyCredParams: [],
    });
    const options = await app.request("/api/auth/passkey/options", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "register" }),
    });
    expect(options.status).toBe(200);

    verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: "cred-1",
          publicKey: new Uint8Array([1, 2, 3, 4]),
          counter: 0,
          transports: ["internal"],
        },
      },
    });
    const verified = await app.request("/api/auth/passkey/verify", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "register",
        response: assertion("reg-chal", "cred-1"),
      }),
    });
    expect(verified.status).toBe(200);

    await app.request("/api/auth/logout", { method: "POST", headers: { Cookie: cookie } });

    generateAuthenticationOptions.mockResolvedValue({
      challenge: "auth-chal",
      rpId: "localhost",
      userVerification: "required",
    });
    const authOptions = await app.request("/api/auth/passkey/options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "authenticate" }),
    });
    expect(authOptions.status).toBe(200);

    verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: {
        credentialID: "cred-1",
        newCounter: 1,
        userVerified: true,
      },
    });
    const login = await app.request("/api/auth/passkey/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "authenticate",
        response: assertion("auth-chal", "cred-1"),
      }),
    });
    expect(login.status).toBe(200);
    const session = (login.headers.get("set-cookie") ?? "").split(";")[0];
    expect(session).toMatch(/helix_session=/);
    const me = await app.request("/api/me", { headers: { Cookie: session } });
    expect(me.status).toBe(200);
  });

  it("requires a session to register a passkey", async () => {
    const { app } = await testApp();
    const res = await app.request("/api/auth/passkey/options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "register" }),
    });
    expect(res.status).toBe(401);
  });
});
