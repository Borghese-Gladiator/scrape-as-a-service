import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { Worker } from 'bullmq';
import { chromium } from 'playwright';
import { closePool, getPool } from '@scraper/db';
import {
  createLogger,
  getRedisConnection,
  getStorage,
  loadConfig,
  onShutdown,
  startHealthServer,
  SCRAPE_QUEUE_NAME,
  type ScrapeJobData,
} from '@scraper/shared';
import { createBrowserPool } from './browser.js';
import { processRun } from './process-run.js';

export async function startWorker(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger('worker');
  const pool = getPool(config);
  const storage = getStorage(config);
  await storage.ensureBucket();

  const workerId = `${hostname()}-${randomUUID()}`;
  const browsers = createBrowserPool(() => chromium.launch());
  let activeJobs = 0;

  const worker = new Worker<ScrapeJobData>(
    SCRAPE_QUEUE_NAME,
    async (job) => {
      activeJobs += 1;
      try {
        await processRun(job, {
          pool,
          storage,
          workerId,
          getBrowser: () => browsers.get(),
          runTimeoutMs: config.runTimeoutMs,
          logger,
          allowCdp: config.allowCdp,
          allowLocalProfile: config.allowLocalProfile,
        });
      } finally {
        activeJobs -= 1;
      }
    },
    {
      connection: getRedisConnection(config),
      concurrency: config.workerConcurrency,
      stalledInterval: 30_000,
      maxStalledCount: 1,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'job failed');
  });

  const health = await startHealthServer({
    port: config.workerHealthPort,
    details: () => ({ workerId, activeJobs }),
    logger,
  });

  onShutdown(
    async () => {
      // close() drains the active jobs and closes the Redis connection BullMQ owns.
      await worker.close();
      await browsers.close();
      await health.close();
      await closePool();
    },
    {
      onSignal: (signal) => {
        logger.info({ signal }, `worker ${workerId} shutting down`);
      },
    },
  );

  logger.info(
    { workerId, concurrency: config.workerConcurrency, healthPort: health.port },
    'worker started',
  );
}

const isMain = process.argv[1]?.endsWith('index.js');
if (isMain) {
  startWorker().catch((err) => {
    createLogger('worker').fatal({ err }, 'worker failed to start');
    process.exit(1);
  });
}
