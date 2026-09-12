import { Pool } from 'pg';
import { runMigrations } from '@scraper/db';
import { getStorage } from '@scraper/shared';
import { migrationsDir } from './paths.js';
import { testConfig } from './config.js';
import { SERVICES_FLAG, unreachableServices, waitForServices } from './services.js';

const START_HINT = [
  'Start them with:',
  '  npm run test:integration:up',
  'Stop them with:',
  '  npm run test:integration:down',
].join('\n');

export async function setup(): Promise<void> {
  const config = testConfig();
  const required = process.env.INTEGRATION_REQUIRED === '1';
  const missing = required
    ? await waitForServices(config, 60_000)
    : await unreachableServices(config);

  if (missing.length > 0) {
    const message = `Integration services are unreachable: ${missing.join(', ')}.\n${START_HINT}`;
    if (required) {
      throw new Error(message);
    }
    process.env[SERVICES_FLAG] = 'unavailable';
    console.warn(`\nSKIPPING the integration suite.\n${message}\n`);
    return;
  }

  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    await runMigrations(pool, migrationsDir());
  } finally {
    await pool.end();
  }

  await getStorage(config).ensureBucket();
  process.env[SERVICES_FLAG] = 'available';
}
