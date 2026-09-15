import { afterAll, beforeEach, describe } from 'vitest';
import { Pool } from 'pg';
import type { AppConfig } from '@scraper/shared';
import { testConfig } from './config.js';
import { servicesAvailable } from './services.js';

/**
 * `describe` when the Docker test services are up, `describe.skip` otherwise.
 * The global setup prints the reason once, so a skipped run is never silent.
 */
export const describeIntegration = servicesAvailable() ? describe : describe.skip;

const TABLES = [
  'artifacts',
  'scrape_run_attempts',
  'scrape_runs',
  'scrape_schedules',
  'scrape_definitions',
];

export async function truncateAll(pool: Pool): Promise<void> {
  await pool.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

export interface TestDb {
  pool: Pool;
  config: AppConfig;
}

/**
 * Open one pool for the file, truncate every table before each test, and close
 * the pool when the file finishes. Tests therefore never leak state into each
 * other.
 */
export function useTestDb(): TestDb {
  const config = testConfig();
  const pool = new Pool({ connectionString: config.databaseUrl });

  beforeEach(async () => {
    await truncateAll(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  return { pool, config };
}
