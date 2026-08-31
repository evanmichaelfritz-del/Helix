import { useEffect, useState, type FormEvent } from "react";
import { Route, Routes, Navigate } from "react-router-dom";
import {
  applyChrome,
  isSessionUnlocked,
  markUnlocked,
  persistHelixTheme,
  storedCredentialId,
  unlockFaceId,
  watchSystemTheme,
} from "./lib/chrome.ts";
import { BrandMark, GoogleMark, XMark } from "./components/icons.tsx";
import type { UserPublic } from "@shared/types.ts";
import { ApiError, client } from "./lib/api.ts";
import { AppStateProvider, useAppState } from "./lib/state.tsx";
import { AppDataLoader } from "./lib/app-data.tsx";
import { Shell } from "./components/Shell.tsx";
import { BootScreen } from "./components/BootScreen.tsx";
import { Sheets, ToastBar } from "./components/Sheets.tsx";
import { AuthPage } from "./pages/Auth.tsx";
import { AccountPage } from "./pages/Account.tsx";
import { CalendarPage } from "./pages/Calendar.tsx";
import { DoseLogPage, PeptidesPage, ProtocolLayout, VialsPage } from "./pages/Protocol.tsx";
import { TodayPage } from "./pages/Today.tsx";
import { VitalsPage } from "./pages/Vitals.tsx";

export function App() {
  return (
    <AppStateProvider>
      <Root />
    </AppStateProvider>
  );
}

function Root() {
  const { user, setUser } = useAppState();
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(false);
  const [savePasskey, setSavePasskey] = useState(false);

  useEffect(() => {
    client
      .me()
      .then((r) => {
        setUser(r.user);
        applyChrome(r.user.settings);
        persistHelixTheme(r.user.settings.theme);
        const q = new URLSearchParams(window.location.search);
        if (q.get("unlocked") === "1") {
          markUnlocked();
          q.delete("unlocked");
          const url = new URL(window.location.href);
          url.searchParams.delete("unlocked");
          window.history.replaceState({}, "", `${url.pathname}${url.search}`);
        }
        const need =
          r.user.settings.faceId &&
          Boolean(storedCredentialId(r.user.id)) &&
          !isSessionUnlocked();
        const forceLock =
          import.meta.env.DEV && new URLSearchParams(window.location.search).get("lock") === "1";
        setLocked(need || forceLock);
        if (q.get("new") === "1") {
          setSavePasskey(true);
        }
      })
      .catch((err: unknown) => {
        if (!(err instanceof ApiError) || err.status !== 401) {
          console.error(err);
        }
        setUser(null);
      })
      .finally(() => setReady(true));
  }, [setUser]);

  useEffect(() => {
    if (user) {
      applyChrome(user.settings);
      persistHelixTheme(user.settings.theme);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return watchSystemTheme(() => ({
      theme: user.settings.theme,
      reduceEffects: user.settings.reduceEffects,
    }));
  }, [user]);

  const holdBoot =
    import.meta.env.DEV && new URLSearchParams(window.location.search).get("boot") === "1";
  if (!ready || holdBoot) return <BootScreen />;
  if (!user) return <AuthPage onSignedUp={() => setSavePasskey(true)} />;
  if (savePasskey) {
    return (
      <AuthPage
        offerSavePasskey
        onDone={() => {
          setSavePasskey(false);
          const url = new URL(window.location.href);
          url.searchParams.delete("new");
          url.searchParams.delete("auth_error");
          window.history.replaceState({}, "", `${url.pathname}${url.search}`);
        }}
      />
    );
  }

  return (
    <>
      {locked ? (
        <LockScreen
          user={user}
          onUnlock={() => {
            markUnlocked();
            setLocked(false);
          }}
        />
      ) : null}
      <AppDataLoader />
      <Shell>
        <Routes>
          <Route path="/" element={<TodayPage />} />
          <Route path="/health" element={<VitalsPage />} />
          <Route path="/protocol" element={<ProtocolLayout />}>
            <Route index element={<Navigate to="vials" replace />} />
            <Route path="peptides" element={<PeptidesPage />} />
            <Route path="vials" element={<VialsPage />} />
            <Route path="log" element={<DoseLogPage />} />
          </Route>
          <Route path="/account" element={<AccountPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
        </Routes>
      </Shell>
      <Sheets />
      <ToastBar />
    </>
  );
}

type LockBusy = null | "face" | "google" | "x" | "password" | "logout";

function LockScreen(props: { user: UserPublic; onUnlock: () => void }) {
  const { setUser } = useAppState();
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState(props.user.email ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<LockBusy>(null);
  const disabled = busy !== null;

  async function unlockFace() {
    setBusy("face");
    setError(null);
    try {
      const ok = await unlockFaceId(props.user.id);
      if (ok) props.onUnlock();
      else setError("Face ID did not match.");
    } catch {
      setError("Face ID cancelled.");
    } finally {
      setBusy(null);
    }
  }

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    setBusy("password");
    setError(null);
    try {
      const { user } = await client.login(email.trim(), password);
      setUser(user);
      props.onUnlock();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Could not sign in.");
    } finally {
      setBusy(null);
    }
  }

  function startOAuth(provider: "google" | "x") {
    setBusy(provider);
    setError(null);
    window.location.assign(provider === "google" ? "/api/auth/google" : "/api/auth/x");
  }

  async function logout() {
    setBusy("logout");
    setError(null);
    try {
      await client.logout();
      setUser(null);
      location.assign("/");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Could not log out.");
      setBusy(null);
    }
  }

  return (
    <div className="lock chrome">
      <div className="card">
        <div className="lock-brand">
          <BrandMark />
          <strong>Helix</strong>
        </div>
        <h2>Unlock</h2>
        <p className="muted">
          {props.user.email ?? props.user.displayName ?? "Signed in with X"}
        </p>
        <div className="stack">
          <button className="btn" type="button" disabled={disabled} onClick={() => void unlockFace()}>
            {busy === "face" ? "…" : "Unlock with Face ID"}
          </button>
          <button type="button" className="btn ghost" disabled={disabled} onClick={() => startOAuth("google")}>
            {busy === "google" ? "…" : (
              <>
                <GoogleMark />
                Continue with Google
              </>
            )}
          </button>
          <button type="button" className="btn ghost" disabled={disabled} onClick={() => startOAuth("x")}>
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
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
              disabled={disabled}
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button className="btn" disabled={disabled}>
            {busy === "password" ? "…" : "Log in"}
          </button>
        </form>
        <button
          type="button"
          className="btn ghost"
          style={{ marginTop: 12 }}
          disabled={disabled}
          onClick={() => void logout()}
        >
          {busy === "logout" ? "…" : "Log out"}
        </button>
      </div>
    </div>
  );
}
