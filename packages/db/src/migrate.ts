import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { createLogger } from '@scraper/shared';
import { getPool } from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const logger = createLogger('db');

/** Resolve the migrations directory relative to the package root (dist/ -> ../migrations). */
function defaultMigrationsDir(): string {
  return join(__dirname, '..', 'migrations');
}

async function ensureMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function appliedMigrations(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations',
  );
  return new Set(rows.map((r) => r.filename));
}

/**
 * Apply pending SQL migrations in filename order. Each file runs inside a
 * transaction; already-applied files (tracked in schema_migrations) are skipped.
 * Idempotent.
 */
export async function runMigrations(
  pool: Pool,
  migrationsDir: string = defaultMigrationsDir(),
): Promise<void> {
  await ensureMigrationsTable(pool);
  const applied = await appliedMigrations(pool);

  const entries = await readdir(migrationsDir);
  const files = entries.filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = await readFile(join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      logger.info({ file }, 'applied migration');
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration failed: ${file}: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
}

/** CLI entrypoint used inside Docker: node dist/migrate.js */
export async function migrateCli(): Promise<void> {
  const pool = getPool();
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  migrateCli()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.fatal({ err }, 'migration run failed');
      process.exit(1);
    });
}
