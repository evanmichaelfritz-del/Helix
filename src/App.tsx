import { useEffect, useState } from "react";
import { Route, Routes, Navigate } from "react-router-dom";
import { applyChrome, persistHelixTheme, storedCredentialId, unlockFaceId, watchSystemTheme } from "./lib/chrome.ts";
import { ApiError, client } from "./lib/api.ts";
import { AppStateProvider, useAppState } from "./lib/state.tsx";
import { AppDataLoader } from "./lib/app-data.tsx";
import { Shell } from "./components/Shell.tsx";
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
        const need =
          r.user.settings.faceId &&
          Boolean(storedCredentialId(r.user.id)) &&
          sessionStorage.getItem("helix_unlocked") !== "1";
        setLocked(need);
        if (new URLSearchParams(window.location.search).get("new") === "1") {
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

  if (!ready) {
    return (
      <div className="auth">
        <p className="muted">Helix</p>
      </div>
    );
  }
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
          userId={user.id}
          onUnlock={() => {
            sessionStorage.setItem("helix_unlocked", "1");
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

function LockScreen(props: { userId: string; onUnlock: () => void }) {
  const [error, setError] = useState<string | null>(null);
  async function unlock() {
    try {
      const ok = await unlockFaceId(props.userId);
      if (ok) props.onUnlock();
      else setError("Face ID did not match.");
    } catch {
      setError("Face ID cancelled.");
    }
  }
  return (
    <div className="lock chrome">
      <div className="card">
        <h2>Helix</h2>
        <p className="muted">Unlock with Face ID</p>
        {error ? <p className="error">{error}</p> : null}
        <button className="btn" type="button" onClick={() => void unlock()}>
          Unlock
        </button>
      </div>
    </div>
  );
}
