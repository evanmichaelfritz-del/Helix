# Helix

Overall health tracker. Peptide tracking is one module.

Vite + React 19 client, Hono API. SQLite on your machine. Neon Postgres on Vercel Hobby.

## Local

```bash
npm install
cp .env.example .env
npm run dev
```

App: http://localhost:5173  
API: http://127.0.0.1:3000

Leave `DATABASE_URL` empty to use SQLite at `data/helix.db`. Set `file:data/helix.db` if you want that explicit. `SESSION_SECRET` can stay the example value locally.

```bash
npm test
npm run build
```

## Vercel Hobby + Neon

1. Create a free Neon project. Copy the connection string (`postgres://` or `postgresql://`).
2. On Vercel, import this GitHub repo (`evanmichaelfritz-del/Helix`).
3. Set environment variables:
   - `DATABASE_URL` = the Neon string
   - `SESSION_SECRET` = a long random value (`openssl rand -base64 32`)
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` = Google OAuth client (redirect `https://helix-green-one.vercel.app/api/auth/google/callback`)
   - `X_CLIENT_ID` / `X_CLIENT_SECRET` = X OAuth client (redirect `https://helix-green-one.vercel.app/api/auth/x/callback`)
   - `WEBAUTHN_RP_ID` = `helix-green-one.vercel.app`
   - Optional `APP_ORIGIN` = `https://helix-green-one.vercel.app`
4. Deploy. Hobby is enough. Only `api/index.ts` is a serverless function. The Hono app lives in `server/`. It will not use SQLite on Vercel. On first request it runs a Postgres schema (`jsonb`, `boolean`, `timestamptz`, `double precision`).

PWA name is Helix. Add to Home Screen on your phone after the first deploy.

## Tabs

Mobile dock has four tabs: Today `/`, Vitals `/health`, Protocol `/protocol`, You `/account`. No Calendar tab on the phone. Desktop rail can open Calendar and sources.

Today shows the HealthDay whose `loggedOn` is today, not the first row in a list. Recovery % is Whoop when present (green ≥67, amber 34–66, red ≤33). Otherwise Garmin body battery, otherwise sleep hours. Helix does not invent a recovery score.

Import lives on Vitals and You. See [IMPORT.md](IMPORT.md). https://helix-peptides.grok.me is an import source only. This repo does not publish a grok.me app.
