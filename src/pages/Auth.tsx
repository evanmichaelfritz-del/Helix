import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { ApiError, client } from "../lib/api.ts";
import { BrandMark, GoogleMark, XMark } from "../components/icons.tsx";
import { useAppState } from "../lib/state.tsx";
import type { UserPublic } from "@shared/types.ts";

type Mode = "login" | "signup";
type View = "auth" | "forgot" | "reset" | "save-passkey";
type Busy = null | "passkey" | "google" | "x" | "password" | "forgot" | "save-passkey" | "reset";

function isIPhoneOrIPad(): boolean {
  return typeof navigator !== "undefined" && /iPhone|iPad/i.test(navigator.userAgent);
}

function passkeySignInLabel(): string {
  return isIPhoneOrIPad() ? "Sign in with Face ID" : "Sign in with passkey";
}

function savePasskeyLabel(): string {
  return isIPhoneOrIPad() ? "Save Face ID for next time" : "Save a passkey for next time";
}

export function AuthPage(props: { offerSavePasskey?: boolean; onSignedUp?: () => void; onDone?: () => void }) {
  const { setUser } = useAppState();
  const [mode, setMode] = useState<Mode>("login");
  const [view, setView] = useState<View>(props.offerSavePasskey ? "save-passkey" : "auth");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [passkeyOk, setPasskeyOk] = useState(false);
  const [passkeyChecked, setPasskeyChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      const available =
        typeof PublicKeyCredential !== "undefined" &&
        typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function" &&
        (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
      if (!cancelled) {
        setPasskeyOk(Boolean(available));
        setPasskeyChecked(true);
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const authError = q.get("auth_error");
    if (authError) setError(authError);
    const token = q.get("reset");
    if (token) {
      setResetToken(token);
      setView("reset");
    }
  }, []);

  useEffect(() => {
    if (props.offerSavePasskey) setView("save-passkey");
  }, [props.offerSavePasskey]);

  const onDoneRef = useRef(props.onDone);
  onDoneRef.current = props.onDone;

  useEffect(() => {
    if (view === "save-passkey" && passkeyChecked && !passkeyOk) onDoneRef.current?.();
  }, [view, passkeyChecked, passkeyOk]);

  const disabled = busy !== null;
  const title =
    view === "forgot" || view === "reset"
      ? "Reset your password"
      : mode === "login"
        ? "Welcome back"
        : "Create account";

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    setBusy("password");
    setError(null);
    try {
      const fn = mode === "login" ? client.login : client.signup;
      const { user } = await fn(email.trim(), password);
      finishAuth(user, mode === "signup");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in.");
    } finally {
      setBusy(null);
    }
  }

  function finishAuth(user: UserPublic, isSignup: boolean) {
    setUser(user);
    if (isSignup && passkeyOk) props.onSignedUp?.();
  }

  async function submitForgot(e: FormEvent) {
    e.preventDefault();
    setBusy("forgot");
    setError(null);
    try {
      await client.forgot(email.trim());
      setForgotSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send reset link.");
    } finally {
      setBusy(null);
    }
  }

  async function submitReset(e: FormEvent) {
    e.preventDefault();
    setBusy("reset");
    setError(null);
    try {
      const { user } = await client.resetPassword(resetToken, password);
      setUser(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reset password.");
    } finally {
      setBusy(null);
    }
  }

  async function signInWithPasskey() {
    setBusy("passkey");
    setError(null);
    try {
      const { options } = await client.passkeyOptions("authenticate");
      const response = await startAuthentication({ optionsJSON: options });
      const result = await client.passkeyVerify("authenticate", response);
      if (result.user) setUser(result.user);
    } catch (err) {
      setError(passkeyError(err, isIPhoneOrIPad() ? "Face ID" : "Passkey"));
    } finally {
      setBusy(null);
    }
  }

  async function savePasskey() {
    setBusy("save-passkey");
    setError(null);
    try {
      const { options } = await client.passkeyOptions("register");
      const response = await startRegistration({ optionsJSON: options });
      await client.passkeyVerify("register", response);
      props.onDone?.();
    } catch (err) {
      setError(passkeyError(err, isIPhoneOrIPad() ? "Face ID" : "Passkey"));
    } finally {
      setBusy(null);
    }
  }

  function startOAuth(provider: "google" | "x") {
    setBusy(provider);
    setError(null);
    window.location.assign(provider === "google" ? "/api/auth/google" : "/api/auth/x");
  }

  function backToLogin() {
    setView("auth");
    setMode("login");
    setForgotSent(false);
    setError(null);
    setPassword("");
    const url = new URL(window.location.href);
    url.searchParams.delete("reset");
    url.searchParams.delete("auth_error");
    window.history.replaceState({}, "", url.pathname + url.search);
  }

  return (
    <div className="auth">
      <div className="card">
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
          <BrandMark />
          <strong>Helix</strong>
        </div>
        <h1>{title}</h1>
        {view === "auth" ? <p>Health tracker. Peptide tracking is one module.</p> : null}

        {view === "auth" ? (
          <>
            <div className="stack">
            {passkeyOk ? (
              <button
                type="button"
                className="btn"
                disabled={disabled}
                onClick={() => void signInWithPasskey()}
              >
                {busy === "passkey" ? "…" : passkeySignInLabel()}
              </button>
            ) : null}
            <button
              type="button"
              className="btn ghost"
              disabled={disabled}
              onClick={() => startOAuth("google")}
            >
              {busy === "google" ? "…" : (
                <>
                  <GoogleMark />
                  Continue with Google
                </>
              )}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={disabled}
              onClick={() => startOAuth("x")}
            >
              {busy === "x" ? "…" : (
                <>
                  <XMark />
                  Continue with X
                </>
              )}
            </button>
            </div>
            <p className="auth-or">or</p>
            <form onSubmit={(e) => void submitPassword(e)}>
              <div className="tabs">
                <button
                  type="button"
                  className={mode === "login" ? "on" : undefined}
                  disabled={disabled}
                  onClick={() => {
                    setMode("login");
                    setError(null);
                  }}
                >
                  Log in
                </button>
                <button
                  type="button"
                  className={mode === "signup" ? "on" : undefined}
                  disabled={disabled}
                  onClick={() => {
                    setMode("signup");
                    setError(null);
                  }}
                >
                  Sign up
                </button>
              </div>
              <label className="field">
                <span>Email</span>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={disabled}
                />
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
                  disabled={disabled}
                />
              </label>
              {mode === "login" ? (
                <button
                  type="button"
                  className="auth-forgot"
                  disabled={disabled}
                  onClick={() => {
                    setView("forgot");
                    setForgotSent(false);
                    setError(null);
                  }}
                >
                  Forgot password?
                </button>
              ) : null}
              <p className="error">{error ?? ""}</p>
              <button className="btn" disabled={disabled}>
                {busy === "password" ? "…" : mode === "login" ? "Log in" : "Create account"}
              </button>
            </form>
          </>
        ) : null}

        {view === "forgot" ? (
          <form onSubmit={(e) => void submitForgot(e)}>
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={disabled}
              />
            </label>
            {forgotSent ? <p>If that email has a Helix password, we sent a link</p> : null}
            {error ? <p className="error">{error}</p> : null}
            <div className="row-btns">
            <button className="btn" disabled={disabled}>
              {busy === "forgot" ? "…" : "Send reset link"}
            </button>
            <button type="button" className="btn ghost" disabled={disabled} onClick={backToLogin}>
              Back to log in
            </button>
            </div>
          </form>
        ) : null}

        {view === "reset" ? (
          <form onSubmit={(e) => void submitReset(e)}>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
                disabled={disabled}
              />
            </label>
            {error ? <p className="error">{error}</p> : null}
            <div className="row-btns">
            <button className="btn" disabled={disabled}>
              {busy === "reset" ? "…" : "Reset your password"}
            </button>
            <button type="button" className="btn ghost" disabled={disabled} onClick={backToLogin}>
              Back to log in
            </button>
            </div>
          </form>
        ) : null}

        {view === "save-passkey" && passkeyOk ? (
          <div className="stack">
            {error ? <p className="error">{error}</p> : null}
            <button
              type="button"
              className="btn ghost"
              disabled={disabled}
              onClick={() => void savePasskey()}
            >
              {busy === "save-passkey" ? "…" : savePasskeyLabel()}
            </button>
            <button type="button" className="btn" disabled={disabled} onClick={() => props.onDone?.()}>
              Continue
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function passkeyError(err: unknown, noun: string): string {
  if (err instanceof ApiError) return err.message;
  const name = err && typeof err === "object" && "name" in err ? String(err.name) : "";
  if (name === "NotAllowedError") return `${noun} was cancelled.`;
  return `${noun} did not work. Try again.`;
}
