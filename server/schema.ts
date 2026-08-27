export const SQLITE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    display_name TEXT,
    settings TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS peptides (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    unit TEXT NOT NULL,
    color TEXT NOT NULL,
    last_amount REAL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS vials (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    peptide_id TEXT NOT NULL REFERENCES peptides(id) ON DELETE CASCADE,
    label TEXT,
    total_amount REAL NOT NULL,
    remaining_amount REAL NOT NULL,
    dose REAL NOT NULL,
    opened_on TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS doses (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    peptide_id TEXT NOT NULL REFERENCES peptides(id) ON DELETE CASCADE,
    vial_id TEXT REFERENCES vials(id) ON DELETE SET NULL,
    amount REAL NOT NULL,
    unit TEXT NOT NULL,
    logged_on TEXT NOT NULL,
    logged_at TEXT NOT NULL,
    undone INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS weigh_ins (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kg REAL NOT NULL,
    logged_on TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS health_days (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    logged_on TEXT NOT NULL,
    whoop_recovery INTEGER,
    garmin_body_battery INTEGER,
    sleep_hours REAL,
    strain REAL,
    steps INTEGER,
    source TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS workouts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    logged_on TEXT NOT NULL,
    name TEXT NOT NULL,
    duration_min INTEGER,
    strain REAL,
    source TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS health_days_user_on ON health_days(user_id, logged_on)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS weigh_ins_user_on ON weigh_ins(user_id, logged_on)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS doses_one_per_day ON doses(user_id, peptide_id, logged_on) WHERE undone = 0`,
  `CREATE INDEX IF NOT EXISTS doses_user_on ON doses(user_id, logged_on)`,
  `CREATE INDEX IF NOT EXISTS workouts_user_on ON workouts(user_id, logged_on)`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS identities (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (provider, provider_user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id TEXT NOT NULL UNIQUE,
    public_key TEXT NOT NULL,
    counter INTEGER NOT NULL,
    transports TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS webauthn_challenges (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    challenge TEXT NOT NULL,
    kind TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS password_resets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS identities_user ON identities(user_id)`,
  `CREATE INDEX IF NOT EXISTS webauthn_credentials_user ON webauthn_credentials(user_id)`,
];

export const POSTGRES_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id text PRIMARY KEY,
    email text NOT NULL UNIQUE,
    password_hash text,
    display_name text,
    settings jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS peptides (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL,
    unit text NOT NULL,
    color text NOT NULL,
    last_amount double precision,
    created_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS vials (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    peptide_id text NOT NULL REFERENCES peptides(id) ON DELETE CASCADE,
    label text,
    total_amount double precision NOT NULL,
    remaining_amount double precision NOT NULL,
    dose double precision NOT NULL,
    opened_on text,
    created_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS doses (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    peptide_id text NOT NULL REFERENCES peptides(id) ON DELETE CASCADE,
    vial_id text REFERENCES vials(id) ON DELETE SET NULL,
    amount double precision NOT NULL,
    unit text NOT NULL,
    logged_on text NOT NULL,
    logged_at timestamptz NOT NULL,
    undone boolean NOT NULL DEFAULT FALSE
  )`,
  `CREATE TABLE IF NOT EXISTS weigh_ins (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kg double precision NOT NULL,
    logged_on text NOT NULL,
    created_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS health_days (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    logged_on text NOT NULL,
    whoop_recovery integer,
    garmin_body_battery integer,
    sleep_hours double precision,
    strain double precision,
    steps integer,
    source text
  )`,
  `CREATE TABLE IF NOT EXISTS workouts (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    logged_on text NOT NULL,
    name text NOT NULL,
    duration_min integer,
    strain double precision,
    source text,
    created_at timestamptz NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS health_days_user_on ON health_days(user_id, logged_on)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS weigh_ins_user_on ON weigh_ins(user_id, logged_on)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS doses_one_per_day ON doses(user_id, peptide_id, logged_on) WHERE NOT undone`,
  `CREATE INDEX IF NOT EXISTS doses_user_on ON doses(user_id, logged_on)`,
  `CREATE INDEX IF NOT EXISTS workouts_user_on ON workouts(user_id, logged_on)`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  `ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`,
  `CREATE TABLE IF NOT EXISTS identities (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider text NOT NULL,
    provider_user_id text NOT NULL,
    created_at timestamptz NOT NULL,
    UNIQUE (provider, provider_user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id text NOT NULL UNIQUE,
    public_key text NOT NULL,
    counter integer NOT NULL,
    transports text,
    created_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS webauthn_challenges (
    id text PRIMARY KEY,
    user_id text REFERENCES users(id) ON DELETE CASCADE,
    challenge text NOT NULL,
    kind text NOT NULL,
    expires_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS password_resets (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS identities_user ON identities(user_id)`,
  `CREATE INDEX IF NOT EXISTS webauthn_credentials_user ON webauthn_credentials(user_id)`,
];

export function schemaFor(dialect: "sqlite" | "postgres"): string[] {
  return dialect === "postgres" ? POSTGRES_SCHEMA : SQLITE_SCHEMA;
}
