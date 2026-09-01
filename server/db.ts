import { mkdir } from "node:fs/promises";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { schemaFor } from "./schema.js";

export type SqlValue = string | number | null | bigint | boolean;

export type SqlBatchStatement = { sql: string; params?: SqlValue[] };

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
  /**
   * One transaction of statements in order. SQLite: BEGIN … COMMIT / ROLLBACK.
   * Neon HTTP: one `sql.transaction([...])` fetch (no Pool/Client).
   */
  batch: (statements: SqlBatchStatement[]) => Promise<unknown[][]>;
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
  if (db.dialect === "sqlite") {
    await sqliteRelaxUsers(db);
    await sqliteAddPeptideSchedule(db);
    await sqliteAddPeptideCopy(db);
    await sqliteAddVialMix(db);
  }
}

async function sqliteAddPeptideCopy(db: Database): Promise<void> {
  const cols = await db.all<{ name: string }>("PRAGMA table_info(peptides)");
  if (!cols.some((col) => col.name === "body_effect")) {
    await db.exec("ALTER TABLE peptides ADD COLUMN body_effect TEXT");
  }
  if (!cols.some((col) => col.name === "expected_results")) {
    await db.exec("ALTER TABLE peptides ADD COLUMN expected_results TEXT");
  }
}

async function sqliteAddVialMix(db: Database): Promise<void> {
  const cols = await db.all<{ name: string }>("PRAGMA table_info(vials)");
  if (!cols.some((col) => col.name === "bac_ml")) {
    await db.exec("ALTER TABLE vials ADD COLUMN bac_ml REAL");
  }
  if (!cols.some((col) => col.name === "syringe_units")) {
    await db.exec("ALTER TABLE vials ADD COLUMN syringe_units INTEGER NOT NULL DEFAULT 30");
  }
}

async function sqliteAddPeptideSchedule(db: Database): Promise<void> {
  const cols = await db.all<{ name: string }>("PRAGMA table_info(peptides)");
  if (cols.some((col) => col.name === "schedule")) return;
  await db.exec(
    `ALTER TABLE peptides ADD COLUMN schedule TEXT NOT NULL DEFAULT '{"days":[0,1,2,3,4,5,6],"morning":true,"evening":false}'`,
  );
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
          throw new Error("Neon HTTP transactions are non-interactive; use db.batch([...])");
        },
        get: async () => {
          throw new Error("Neon HTTP transactions are non-interactive; use db.batch([...])");
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
        batch: async () => {
          throw new Error("Nested batch is not supported");
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
    async batch(statements) {
      if (statements.length === 0) return [];
      const results = await sql.transaction((txn) =>
        statements.map((item) => txn.query(toPg(item.sql), item.params ?? [])),
      );
      return results as unknown[][];
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
    async batch(statements) {
      if (statements.length === 0) return [];
      return db.transaction(async (tx) => {
        const results: unknown[][] = [];
        for (const item of statements) {
          results.push(await tx.all(item.sql, item.params ?? []));
        }
        return results;
      });
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
