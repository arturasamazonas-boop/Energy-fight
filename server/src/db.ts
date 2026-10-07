// Database adapter. Production uses PostgreSQL (e.g. Neon) via DATABASE_URL.
// Local development and tests use embedded PGlite (real Postgres compiled to
// WASM) stored in a directory, so no paid service is needed to run locally.
import pg from "pg";

export interface Queryer {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
}
export interface Db extends Queryer {
  tx<T>(fn: (q: Queryer) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  kind: "postgres" | "pglite";
}

export async function openDb(opts: { url?: string; dataDir?: string }): Promise<Db> {
  if (opts.url) return openPostgres(opts.url);
  return openPglite(opts.dataDir);
}

async function openPostgres(url: string): Promise<Db> {
  const pool = new pg.Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30_000 });
  pool.on("error", (err) => console.error("[db] idle client error", err.message));
  const db: Db = {
    kind: "postgres",
    async query(sql, params) {
      const r = await pool.query(sql, params as any[]);
      return r.rows;
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn({
          async query(sql, params) {
            const r = await client.query(sql, params as any[]);
            return r.rows;
          },
        });
        await client.query("COMMIT");
        return out;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
  await migrate(db);
  return db;
}

async function openPglite(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const lite = dataDir ? new PGlite(dataDir) : new PGlite();
  await lite.waitReady;
  const db: Db = {
    kind: "pglite",
    async query(sql, params) {
      const r = await lite.query(sql, params as any[]);
      return r.rows as any[];
    },
    async tx(fn) {
      return lite.transaction(async (t) =>
        fn({
          async query(sql, params) {
            const r = await t.query(sql, params as any[]);
            return r.rows as any[];
          },
        }),
      );
    },
    async close() {
      await lite.close();
    },
  };
  await migrate(db);
  return db;
}

const MIGRATIONS: string[] = [
  // 1: profiles, per-lineage progress, reward ledger
  `
  CREATE TABLE profiles (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    salvage INTEGER NOT NULL DEFAULT 0 CHECK (salvage >= 0),
    support_marks INTEGER NOT NULL DEFAULT 0,
    tier_unlocked INTEGER NOT NULL DEFAULT 1,
    last_lineage TEXT NOT NULL DEFAULT 'pyra',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE lineage_progress (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    lineage TEXT NOT NULL,
    level INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 20),
    xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
    evolution TEXT,
    modifier TEXT,
    fragments INTEGER NOT NULL DEFAULT 0,
    module_equipped TEXT,
    module_ranks JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (profile_id, lineage)
  );
  CREATE TABLE reward_ledger (
    run_id TEXT NOT NULL,
    section_id INTEGER NOT NULL,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    lineage TEXT NOT NULL,
    eligible BOOLEAN NOT NULL,
    xp INTEGER NOT NULL,
    xp_applied INTEGER NOT NULL,
    salvage INTEGER NOT NULL,
    fragments INTEGER NOT NULL,
    support_mark INTEGER NOT NULL DEFAULT 0,
    level_before INTEGER NOT NULL,
    level_after INTEGER NOT NULL,
    xp_after INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, section_id, profile_id)
  );
  CREATE TABLE runs (
    run_id TEXT PRIMARY KEY,
    room_code TEXT NOT NULL,
    tier INTEGER NOT NULL,
    party_size INTEGER NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ,
    result TEXT
  );
  `,
  // 2: loot crates and equipment
  `
  CREATE TABLE items (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    base_id TEXT NOT NULL,
    slot TEXT NOT NULL,
    rarity TEXT NOT NULL,
    stats JSONB NOT NULL,
    special TEXT,
    source_run TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX items_profile_idx ON items (profile_id);
  CREATE TABLE loot_boxes (
    run_id TEXT NOT NULL,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    tier TEXT NOT NULL,
    impact REAL NOT NULL,
    performance REAL NOT NULL,
    salvage INTEGER NOT NULL,
    item_ids JSONB NOT NULL,
    opened BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, profile_id)
  );
  ALTER TABLE lineage_progress ADD COLUMN equipment JSONB NOT NULL DEFAULT '{}'::jsonb
  `,
  // 3: item upgrade level
  `
  ALTER TABLE items ADD COLUMN plus INTEGER NOT NULL DEFAULT 0 CHECK (plus BETWEEN 0 AND 10)
  `,
  // 4: daily challenge claims (one guaranteed box upgrade per profile per UTC day)
  `
  CREATE TABLE daily_claims (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    run_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, day)
  )
  `,
  // 5: numbered sectors – highest sector a profile may start
  `
  ALTER TABLE profiles ADD COLUMN sector_unlocked INTEGER NOT NULL DEFAULT 1;
  UPDATE profiles SET sector_unlocked = CASE tier_unlocked WHEN 3 THEN 14 WHEN 2 THEN 7 ELSE 1 END
  `,
];

async function migrate(db: Db) {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const rows = await db.query<{ version: number }>(`SELECT version FROM schema_migrations`);
  const done = new Set(rows.map((r) => Number(r.version)));
  for (let i = 0; i < MIGRATIONS.length; i++) {
    const v = i + 1;
    if (done.has(v)) continue;
    await db.tx(async (q) => {
      for (const stmt of MIGRATIONS[i].split(";").map((s) => s.trim()).filter(Boolean)) await q.query(stmt);
      await q.query(`INSERT INTO schema_migrations (version) VALUES ($1)`, [v]);
    });
  }
}
