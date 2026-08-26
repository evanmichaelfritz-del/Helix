import type { FormEvent } from "react";
import { useState } from "react";
import { ApiError, client } from "../lib/api.ts";
import { BrandMark } from "../components/icons.tsx";
import { useAppState } from "../lib/state.tsx";

export function AuthPage() {
  const { setUser } = useAppState();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fn = mode === "login" ? client.login : client.signup;
      const { user } = await fn(email.trim(), password);
      setUser(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <form className="card" onSubmit={(e) => void submit(e)}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
          <BrandMark />
          <strong>Helix</strong>
        </div>
        <h1>{mode === "login" ? "Welcome back" : "Create account"}</h1>
        <p>Health tracker. Peptide tracking is one module.</p>
        <div className="tabs">
          <button type="button" className={mode === "login" ? "on" : undefined} onClick={() => setMode("login")}>
            Log in
          </button>
          <button type="button" className={mode === "signup" ? "on" : undefined} onClick={() => setMode("signup")}>
            Sign up
          </button>
        </div>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button className="btn" disabled={busy}>
          {busy ? "…" : mode === "login" ? "Log in" : "Create account"}
        </button>
      </form>
    </div>
  );
}
