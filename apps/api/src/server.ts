import cors from 'cors';
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
import { errorMiddleware } from './http.js';
import { definitionsRouter } from './routes/definitions.js';
import { schedulesRouter } from './routes/schedules.js';
import { runsRouter } from './routes/runs.js';
import { artifactsRouter } from './routes/artifacts.js';

export function createServer(
  pool: Pool,
  queue: Queue<ScrapeJobData>,
  storage: StorageClient,
): Express {
  const app = express();
  // The web UI posts from the browser on another origin, so every route needs
  // CORS. CORS_ORIGINS is a comma-separated allowlist; unset means allow any.
  const allowlist = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  app.use(cors({ origin: allowlist.length > 0 ? allowlist : true }));
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/definitions', definitionsRouter(pool));
  app.use('/schedules', schedulesRouter(pool));
  app.use('/runs', runsRouter(pool, queue));
  app.use('/', artifactsRouter(pool, storage));

  app.use(errorMiddleware);
  return app;
}

export async function startApi(): Promise<void> {
  const config = loadConfig();
  const pool = getPool(config);
  await runMigrations(pool);

  const storage = getStorage(config);
  await storage.ensureBucket();

  const queue = getQueue(config);
  const app = createServer(pool, queue, storage);

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
