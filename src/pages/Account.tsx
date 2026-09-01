import { useState } from "react";
import type { ImportResult } from "@shared/types.ts";
import { themeOptionLabel } from "@shared/theme.ts";
import { ThemeOverlay } from "../components/ThemeOverlay.tsx";
import { GROK_ME } from "../lib/grok.ts";
import { ApiError, client } from "../lib/api.ts";
import {
  applyChrome,
  clearFaceId,
  faceIdAvailable,
  isIPhoneOrIPad,
  persistHelixTheme,
  registerFaceId,
  storedCredentialId,
  themeBooted,
} from "../lib/chrome.ts";
import { useAppState } from "../lib/state.tsx";
import { FilePicker, ImportedCounts } from "./Vitals.tsx";

export function AccountPage() {
  const { user, setUser, bump } = useAppState();
  const [msg, setMsg] = useState<string | null>(null);
  const [imported, setImported] = useState<ImportResult | null>(null);
  const [themeOpen, setThemeOpen] = useState(false);
  if (!user) return null;
  const s = user.settings;

  async function patch(partial: Partial<typeof s>, persistTheme = false) {
    const next = { ...s, ...partial };
    if (persistTheme && partial.theme) {
      if (!themeBooted()) return;
      persistHelixTheme(partial.theme);
    }
    applyChrome(next);
    setUser({ ...account, settings: next });
    try {
      const res = await client.patchMe({ settings: next });
      setUser(res.user);
    } catch (err: unknown) {
      applyChrome(s);
      setUser(account);
      setMsg(err instanceof ApiError ? err.message : "Could not save settings.");
    }
  }

  const account = user;
  async function toggleFaceId() {
    if (s.faceId) {
      clearFaceId(account.id);
      await patch({ faceId: false });
      return;
    }
    if (!faceIdAvailable()) {
      setMsg("Face ID is not available on this device.");
      return;
    }
    try {
      const ok = await registerFaceId({
        userId: account.id,
        email: account.email,
        displayName: account.displayName,
      });
      if (!ok) {
        setMsg("Could not enable Face ID.");
        return;
      }
      await patch({ faceId: true });
    } catch {
      setMsg("Face ID was cancelled.");
    }
  }

  return (
    <>
      <h1>You</h1>
      <article className="card" style={{ padding: "8px 18px 18px" }}>
        <p className="muted" style={{ marginTop: 14 }}>
          {user.email ?? user.displayName ?? "Signed in with X"}
        </p>
        <div className="toggle">
          <div>
            <strong>Theme</strong>
            <div className="muted">Follow system, light, or dark</div>
          </div>
          <button type="button" className="theme-open" onClick={() => setThemeOpen(true)}>
            {themeOptionLabel(s.theme)}
          </button>
        </div>
        {isIPhoneOrIPad() ? (
          <div className="toggle">
            <div>
              <strong>Face ID</strong>
              <div className="muted">
                {faceIdAvailable()
                  ? storedCredentialId(user.id)
                    ? "Unlock this device with Face ID"
                    : "Register this device"
                  : "Not available on this device"}
              </div>
            </div>
            <button type="button" className={s.faceId ? "on" : undefined} onClick={() => void toggleFaceId()} aria-pressed={s.faceId}>
              <i />
            </button>
          </div>
        ) : null}
        <div className="toggle">
          <div>
            <strong>Reduce effects</strong>
            <div className="muted">No blur, no motion</div>
          </div>
          <button
            type="button"
            className={s.reduceEffects ? "on" : undefined}
            onClick={() => void patch({ reduceEffects: !s.reduceEffects })}
            aria-pressed={s.reduceEffects}
          >
            <i />
          </button>
        </div>
        <div className="toggle">
          <div>
            <strong>Weight</strong>
          </div>
          <select
            value={s.weightUnit}
            onChange={(e) => void patch({ weightUnit: e.target.value as typeof s.weightUnit })}
          >
            <option value="lb">lb</option>
            <option value="kg">kg</option>
          </select>
        </div>
      </article>

      <section className="section">
        <p className="kicker" style={{ marginBottom: 10 }}>
          grok.me
        </p>
        <article className="card" style={{ padding: 18 }}>
          <p className="muted">
            Continue on grok.me, then drop the helper JSON here. Wearable files go on Vitals.
            Helix never fetches helix-peptides.grok.me RPCs and does not migrate by email.
          </p>
          <a className="btn" style={{ marginTop: 14 }} href={GROK_ME} target="_blank" rel="noreferrer">
            Continue on grok.me
          </a>
          <div style={{ marginTop: 12 }}>
            <FilePicker
              label="Helix helper JSON"
              hint="Drop the grok.me helper JSON. Token paste is rejected."
              accept=".json,.zip"
              onImported={(result, text) => {
                setImported(result);
                setMsg(text);
                if (result) bump();
              }}
            />
          </div>
          {imported ? <ImportedCounts result={imported} /> : null}
          {msg && !imported ? <p className="muted" style={{ marginTop: 10 }}>{msg}</p> : null}
        </article>
      </section>

      <button
        className="btn ghost"
        style={{ marginTop: 24 }}
        type="button"
        onClick={() => {
          void client.logout().then(() => {
            setUser(null);
            location.assign("/");
          }).catch((err: unknown) => {
            if (err instanceof ApiError) setMsg(err.message);
          });
        }}
      >
        Log out
      </button>
      {themeOpen ? (
        <ThemeOverlay
          theme={s.theme}
          reduceEffects={s.reduceEffects}
          onCancel={() => setThemeOpen(false)}
          onSave={(theme) => {
            setThemeOpen(false);
            void patch({ theme }, true);
          }}
        />
      ) : null}
    </>
  );
}
