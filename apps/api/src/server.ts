import cors from 'cors';
import express, { type Express } from 'express';
import type { Pool } from 'pg';
import type { Queue } from 'bullmq';
import { getPool, runMigrations } from '@scraper/db';
import {
  DEFAULT_CORS_ORIGINS,
  createLogger,
  getQueue,
  getStorage,
  loadConfig,
  type Logger,
  type ScrapeJobData,
  type StorageClient,
} from '@scraper/shared';
import { apiKeyMiddleware, assertApiKeyPolicy } from './auth.js';
import { errorMiddleware } from './http.js';
import { requestLogger } from './logging.js';
import { buildOpenApiDocument } from './openapi.js';
import { definitionsRouter, type AssertUrl } from './routes/definitions.js';
import { runsRouter } from './routes/runs.js';
import { artifactsRouter } from './routes/artifacts.js';
import { secretsRouter } from './routes/secrets.js';

export interface ServerOptions {
  corsOrigins?: string[];
  logger?: Logger;
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
  const {
    corsOrigins = DEFAULT_CORS_ORIGINS,
    logger = createLogger('api'),
    apiKey = '',
    assertUrl,
  } = options;
  const app = express();
  app.use(cors({ origin: corsOrigins }));
  app.use(express.json());
  app.use(requestLogger(logger));
  app.use(apiKeyMiddleware(apiKey));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/openapi.json', (_req, res) => {
    res.json(buildOpenApiDocument());
  });

  app.use('/definitions', definitionsRouter(pool, assertUrl));
  app.use('/runs', runsRouter(pool, queue));
  app.use('/secrets', secretsRouter(pool));
  app.use('/', artifactsRouter(pool, storage));

  app.use(errorMiddleware);
  return app;
}

export async function startApi(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger('api');
  assertApiKeyPolicy(config.apiKey);

  const pool = getPool(config);
  await runMigrations(pool);

  const storage = getStorage(config);
  await storage.ensureBucket();

  const queue = getQueue(config);
  const app = createServer(pool, queue, storage, {
    corsOrigins: config.corsOrigins,
    logger,
    apiKey: config.apiKey,
  });

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
