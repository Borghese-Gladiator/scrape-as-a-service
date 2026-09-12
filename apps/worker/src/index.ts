import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { Worker } from 'bullmq';
import { chromium } from 'playwright';
import { getPool } from '@scraper/db';
import {
  createLogger,
  getRedisConnection,
  getStorage,
  loadConfig,
  startHealthServer,
  SCRAPE_QUEUE_NAME,
  type ScrapeJobData,
} from '@scraper/shared';
import { processRun } from './process-run.js';

export async function startWorker(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger('worker');
  const pool = getPool(config);
  const storage = getStorage(config);
  await storage.ensureBucket();

  const workerId = `${hostname()}-${randomUUID()}`;
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
          launchBrowser: () => chromium.launch(),
          logger,
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

  await startHealthServer({
    port: config.workerHealthPort,
    details: () => ({ workerId, activeJobs }),
    logger,
  });

  logger.info(
    { workerId, concurrency: config.workerConcurrency, healthPort: config.workerHealthPort },
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
