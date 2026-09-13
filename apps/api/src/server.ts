import express, { type Express } from 'express';
import type { Pool } from 'pg';
import type { Queue } from 'bullmq';
import { getPool, runMigrations } from '@scraper/db';
import {
  getQueue,
  getStorage,
  loadConfig,
  type ScrapeJobData,
  type StorageClient,
} from '@scraper/shared';
import { apiKeyMiddleware, assertApiKeyPolicy } from './auth.js';
import { errorMiddleware } from './http.js';
import { definitionsRouter, type AssertUrl } from './routes/definitions.js';
import { schedulesRouter } from './routes/schedules.js';
import { runsRouter } from './routes/runs.js';
import { artifactsRouter } from './routes/artifacts.js';
import { secretsRouter } from './routes/secrets.js';

export interface ServerOptions {
  /** Empty turns the `X-API-Key` check off. */
  apiKey?: string;
  /** The SSRF guard for the definition URL. Tests replace it to stay hermetic. */
  assertUrl?: AssertUrl;
}

export function createServer(
  pool: Pool,
  queue: Queue<ScrapeJobData>,
  storage: StorageClient,
  options: ServerOptions = {},
): Express {
  const app = express();
  app.use(express.json());
  app.use(apiKeyMiddleware(options.apiKey ?? ''));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/definitions', definitionsRouter(pool, options.assertUrl));
  app.use('/schedules', schedulesRouter(pool));
  app.use('/runs', runsRouter(pool, queue));
  app.use('/secrets', secretsRouter(pool));
  app.use('/', artifactsRouter(pool, storage));

  app.use(errorMiddleware);
  return app;
}

export async function startApi(): Promise<void> {
  const config = loadConfig();
  assertApiKeyPolicy(config.apiKey);

  const pool = getPool(config);
  await runMigrations(pool);

  const storage = getStorage(config);
  await storage.ensureBucket();

  const queue = getQueue(config);
  const app = createServer(pool, queue, storage, { apiKey: config.apiKey });

  app.listen(config.apiPort, () => {
    // eslint-disable-next-line no-console
    console.log(`api listening on :${config.apiPort}`);
  });
}

const isMain = process.argv[1]?.endsWith('server.js');
if (isMain) {
  startApi().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
