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
  /**
   * SQLite: interactive BEGIN/COMMIT on the same connection.
   * Neon HTTP: collect writes, then one `sql.transaction([...])` fetch (non-interactive).
   */
  transaction: <T>(fn: (tx: Database) => Promise<T>) => Promise<T>;
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
  if (db.dialect === "sqlite") await sqliteRelaxUsers(db);
}

async function sqliteRelaxUsers(db: Database): Promise<void> {
  const cols = await db.all<{ name: string; notnull: number }>("PRAGMA table_info(users)");
  const hash = cols.find((col) => col.name === "password_hash");
  const email = cols.find((col) => col.name === "email");
  const hashLocked = Boolean(hash && hash.notnull === 1);
  const emailLocked = Boolean(email && email.notnull === 1);
  if (!hashLocked && !emailLocked) return;
  await db.exec("PRAGMA foreign_keys = OFF");
  try {
    await db.exec("BEGIN");
    await db.exec(`CREATE TABLE users_relax_nulls (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      password_hash TEXT,
      display_name TEXT,
      settings TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    )`);
    await db.exec(
      "INSERT INTO users_relax_nulls (id, email, password_hash, display_name, settings, created_at) SELECT id, email, password_hash, display_name, settings, created_at FROM users",
    );
    await db.exec("DROP TABLE users");
    await db.exec("ALTER TABLE users_relax_nulls RENAME TO users");
    await db.exec("COMMIT");
  } catch (err) {
    try {
      await db.exec("ROLLBACK");
    } catch {
      /* no open transaction */
    }
    throw err;
  } finally {
    await db.exec("PRAGMA foreign_keys = ON");
  }
}

function toPg(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

function createNeonDb(url: string): Database {
  const sql = neon(url);
  const db: Database = {
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
    async transaction(fn) {
      const queued: { query: string; params: SqlValue[] }[] = [];
      const tx: Database = {
        dialect: "postgres",
        all: async () => {
          throw new Error("Neon HTTP transactions are non-interactive; read before db.transaction()");
        },
        get: async () => {
          throw new Error("Neon HTTP transactions are non-interactive; read before db.transaction()");
        },
        run: async (query, params = []) => {
          queued.push({ query, params });
          return { changes: 0 };
        },
        exec: async (statement) => {
          queued.push({ query: statement, params: [] });
        },
        transaction: async () => {
          throw new Error("Nested transactions are not supported");
        },
      };
      const result = await fn(tx);
      if (queued.length > 0) {
        await sql.transaction((txn) =>
          queued.map((item) => txn.query(toPg(item.query), item.params)),
        );
      }
      return result;
    },
  };
  return db;
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
  const db: Database = {
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
    async transaction(fn) {
      await client.execute("BEGIN");
      try {
        const result = await fn(db);
        await client.execute("COMMIT");
        return result;
      } catch (err) {
        try {
          await client.execute("ROLLBACK");
        } catch {
          /* no open transaction */
        }
        throw err;
      }
    },
  };
  return db;
}

const migrated = new WeakSet<Database>();

export async function ensureMigrated(db: Database): Promise<void> {
  if (migrated.has(db)) return;
  await migrate(db);
  migrated.add(db);
}
