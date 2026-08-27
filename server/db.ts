import { mkdir } from "node:fs/promises";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { schemaFor } from "./schema.js";

export type SqlValue = string | number | null | bigint | boolean;

export type Database = {
  dialect: "sqlite" | "postgres";
  all: <T>(sql: string, params?: SqlValue[]) => Promise<T[]>;
  get: <T>(sql: string, params?: SqlValue[]) => Promise<T | undefined>;
  run: (sql: string, params?: SqlValue[]) => Promise<{ changes: number }>;
  exec: (sql: string) => Promise<void>;
};

export function isPostgresUrl(url: string | undefined): boolean {
  if (!url) return false;
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

export async function connectDb(url = process.env.DATABASE_URL): Promise<Database> {
  if (process.env.VERCEL && !isPostgresUrl(url)) {
    throw new Error(
      "Vercel requires DATABASE_URL pointing at Neon Postgres (postgres:// or postgresql://).",
    );
  }
  if (isPostgresUrl(url) && url) {
    return createNeonDb(url);
  }
  const fileUrl = url && url.startsWith("file:") ? url : "file:data/helix.db";
  return createSqliteDb(fileUrl);
}

export async function migrate(db: Database): Promise<void> {
  for (const statement of schemaFor(db.dialect)) {
    await db.exec(statement);
  }
  if (db.dialect === "sqlite") await sqliteRelaxPasswordHash(db);
}

async function sqliteRelaxPasswordHash(db: Database): Promise<void> {
  const cols = await db.all<{ name: string; notnull: number }>("PRAGMA table_info(users)");
  const hash = cols.find((col) => col.name === "password_hash");
  if (!hash || hash.notnull === 0) return;
  await db.exec("PRAGMA foreign_keys = OFF");
  await db.exec(`CREATE TABLE users_password_hash_relax (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    display_name TEXT,
    settings TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  )`);
  await db.exec(
    "INSERT INTO users_password_hash_relax (id, email, password_hash, display_name, settings, created_at) SELECT id, email, password_hash, display_name, settings, created_at FROM users",
  );
  await db.exec("DROP TABLE users");
  await db.exec("ALTER TABLE users_password_hash_relax RENAME TO users");
  await db.exec("PRAGMA foreign_keys = ON");
}

function toPg(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

function createNeonDb(url: string): Database {
  const sql = neon(url);
  return {
    dialect: "postgres",
    async all<T>(query: string, params: SqlValue[] = []) {
      const rows = await sql.query(toPg(query), params);
      return rows as T[];
    },
    async get<T>(query: string, params: SqlValue[] = []) {
      const rows = await sql.query(toPg(query), params);
      return (rows as T[])[0];
    },
    async run(query: string, params: SqlValue[] = []) {
      await sql.query(toPg(query), params);
      return { changes: 0 };
    },
    async exec(statement: string) {
      const tpl = Object.assign([statement], { raw: [statement] }) as unknown as TemplateStringsArray;
      await sql(tpl);
    },
  };
}

export async function createSqliteDb(url: string): Promise<Database> {
  const { createClient } = await import("@libsql/client");
  const memory = url === ":memory:" || url === "file::memory:";
  if (!memory && url.startsWith("file:")) {
    const filePath = url.slice("file:".length);
    const dir = path.dirname(filePath);
    if (dir && dir !== ".") await mkdir(dir, { recursive: true });
  }
  const client = createClient({ url: memory ? ":memory:" : url });
  await client.execute("PRAGMA foreign_keys = ON");
  await client.execute("PRAGMA journal_mode = WAL");
  return {
    dialect: "sqlite",
    async all<T>(query: string, params: SqlValue[] = []) {
      const result = await client.execute({ sql: query, args: params });
      return result.rows as unknown as T[];
    },
    async get<T>(query: string, params: SqlValue[] = []) {
      const result = await client.execute({ sql: query, args: params });
      return result.rows[0] as unknown as T | undefined;
    },
    async run(query: string, params: SqlValue[] = []) {
      const result = await client.execute({ sql: query, args: params });
      return { changes: result.rowsAffected };
    },
    async exec(statement: string) {
      await client.execute(statement);
    },
  };
}

const migrated = new WeakSet<Database>();

export async function ensureMigrated(db: Database): Promise<void> {
  if (migrated.has(db)) return;
  await migrate(db);
  migrated.add(db);
}
