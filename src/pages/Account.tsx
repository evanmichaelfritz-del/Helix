import { useState } from "react";
import { GROK_ME } from "../lib/grok.ts";
import { ApiError, client } from "../lib/api.ts";
import {
  applyChrome,
  clearFaceId,
  faceIdAvailable,
  registerFaceId,
  storedCredentialId,
} from "../lib/chrome.ts";
import { useAppState } from "../lib/state.tsx";
import { ImportDrop } from "./Vitals.tsx";

export function AccountPage() {
  const { user, setUser } = useAppState();
  const [msg, setMsg] = useState<string | null>(null);
  if (!user) return null;
  const s = user.settings;

  async function patch(partial: Partial<typeof s>) {
    const next = { ...s, ...partial };
    applyChrome(next);
    const res = await client.patchMe({ settings: next });
    setUser(res.user);
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
      const ok = await registerFaceId({ userId: account.id, email: account.email });
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
          {user.email}
        </p>
        <div className="toggle">
          <div>
            <strong>Theme</strong>
            <div className="muted">System, light, or dark</div>
          </div>
          <select
            value={s.theme}
            onChange={(e) => void patch({ theme: e.target.value as typeof s.theme })}
          >
            <option value="system">System</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>
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
            <option value="kg">kg</option>
            <option value="lb">lb</option>
          </select>
        </div>
      </article>

      <section className="section" id="sources">
        <p className="kicker" style={{ marginBottom: 10 }}>
          Sources
        </p>
        <article className="card" style={{ padding: 18 }}>
          <p className="muted">
            Whoop, Garmin, and Apple Health import from files on Vitals. Garmin body battery needs
            the JSON dailies zip, not Connect Activities CSV.
          </p>
          <a className="btn" style={{ marginTop: 14, textDecoration: "none" }} href={GROK_ME} target="_blank" rel="noreferrer">
            Continue on grok.me
          </a>
          <p className="muted" style={{ marginTop: 14 }}>
            Import from grok.me is a helper-JSON drop. Helix never fetches helix-peptides.grok.me
            RPCs and does not migrate by email.
          </p>
          <div style={{ marginTop: 12 }}>
            <ImportDrop onDone={setMsg} />
          </div>
          {msg ? <p className="muted" style={{ marginTop: 10 }}>{msg}</p> : null}
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
    </>
  );
}
