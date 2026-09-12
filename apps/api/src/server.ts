import express, { type Express } from 'express';
import type { Pool } from 'pg';
import type { Queue } from 'bullmq';
import { getPool, runMigrations } from '@scraper/db';
import {
  createLogger,
  getQueue,
  getStorage,
  loadConfig,
  type Logger,
  type ScrapeJobData,
  type StorageClient,
} from '@scraper/shared';
import { errorMiddleware } from './http.js';
import { requestLogger } from './logging.js';
import { definitionsRouter } from './routes/definitions.js';
import { schedulesRouter } from './routes/schedules.js';
import { runsRouter } from './routes/runs.js';
import { artifactsRouter } from './routes/artifacts.js';

export function createServer(
  pool: Pool,
  queue: Queue<ScrapeJobData>,
  storage: StorageClient,
  logger: Logger = createLogger('api'),
): Express {
  const app = express();
  app.use(express.json());
  app.use(requestLogger(logger));

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
  const logger = createLogger('api');
  const pool = getPool(config);
  await runMigrations(pool);

  const storage = getStorage(config);
  await storage.ensureBucket();

  const queue = getQueue(config);
  const app = createServer(pool, queue, storage, logger);

  app.listen(config.apiPort, () => {
    logger.info({ port: config.apiPort }, 'api listening');
  });
}

const isMain = process.argv[1]?.endsWith('server.js');
if (isMain) {
  startApi().catch((err) => {
    createLogger('api').fatal({ err }, 'api failed to start');
    process.exit(1);
  });
}
