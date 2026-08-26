export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
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
];
