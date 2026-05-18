import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDbPool, type DbClient } from './index';
import { loadConfig } from '../config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_TABLE = 'schema_migrations';
const MIGRATION_LOCK_NAME = 'pixel_world_schema_migrations';

async function ensureMigrationLedger(db: DbClient): Promise<void> {
  await db.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       file_name TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`
  );
}

async function tableExists(db: DbClient, tableName: string): Promise<boolean> {
  const result = await db.query('SELECT to_regclass($1) IS NOT NULL AS exists', [`public.${tableName}`]);
  return Boolean(result.rows[0]?.exists);
}

async function hasLegacyInitialSchema(db: DbClient): Promise<boolean> {
  if (!(await tableExists(db, 'canvases'))) {
    return false;
  }

  const result = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM canvases WHERE id = 'global' AND slug = 'global'
     ) AS exists`
  );
  return Boolean(result.rows[0]?.exists);
}

async function bootstrapAppliedMigrations(db: DbClient): Promise<void> {
  const appliedCount = await db.query(`SELECT count(*)::int AS count FROM ${MIGRATIONS_TABLE}`);
  if (Number(appliedCount.rows[0]?.count ?? 0) > 0) {
    return;
  }

  if (await hasLegacyInitialSchema(db)) {
    await db.query(`INSERT INTO ${MIGRATIONS_TABLE} (file_name) VALUES ($1) ON CONFLICT DO NOTHING`, [
      '001_init.sql'
    ]);
  }
}

async function getAppliedMigrations(db: DbClient): Promise<Set<string>> {
  const result = await db.query<{ file_name: string }>(`SELECT file_name FROM ${MIGRATIONS_TABLE}`);
  return new Set(result.rows.map((row) => row.file_name));
}

export async function runMigrations(): Promise<void> {
  const config = loadConfig();
  const pool = createDbPool(config);
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [MIGRATION_LOCK_NAME]);
    await ensureMigrationLedger(client);
    await bootstrapAppliedMigrations(client);

    const migrationsDir = join(__dirname, '../../migrations');
    const migrationFiles = (await readdir(migrationsDir))
      .filter((fileName) => fileName.endsWith('.sql'))
      .sort();
    const appliedMigrations = await getAppliedMigrations(client);

    for (const migrationFile of migrationFiles) {
      if (appliedMigrations.has(migrationFile)) {
        continue;
      }

      const sql = await readFile(join(migrationsDir, migrationFile), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (file_name) VALUES ($1) ON CONFLICT DO NOTHING`, [migrationFile]);
        await client.query('COMMIT');
        appliedMigrations.add(migrationFile);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK_NAME]);
    } finally {
      client.release();
    }
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
