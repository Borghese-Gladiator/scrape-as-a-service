import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { Worker } from 'bullmq';
import { chromium } from 'playwright';
import { getPool } from '@scraper/db';
import {
  getRedisConnection,
  getStorage,
  loadConfig,
  SCRAPE_QUEUE_NAME,
  type ScrapeJobData,
} from '@scraper/shared';
import { createBrowserPool } from './browser.js';
import { processRun } from './process-run.js';

export async function startWorker(): Promise<void> {
  const config = loadConfig();
  const pool = getPool(config);
  const storage = getStorage(config);
  await storage.ensureBucket();

  const workerId = `${hostname()}-${randomUUID()}`;
  const browsers = createBrowserPool(() => chromium.launch());

  const worker = new Worker<ScrapeJobData>(
    SCRAPE_QUEUE_NAME,
    async (job) => {
      await processRun(job, {
        pool,
        storage,
        workerId,
        getBrowser: () => browsers.get(),
        runTimeoutMs: config.runTimeoutMs,
      });
    },
    {
      connection: getRedisConnection(config),
      concurrency: config.workerConcurrency,
      stalledInterval: 30_000,
      maxStalledCount: 1,
    },
  );

  worker.on('failed', (job, err) => {
    // eslint-disable-next-line no-console
    console.error(`job ${job?.id} failed: ${err.message}`);
  });

  const shutdown = async () => {
    await worker.close().catch(() => {});
    await browsers.close();
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());

  // eslint-disable-next-line no-console
  console.log(
    `worker ${workerId} started (concurrency=${config.workerConcurrency}, timeout=${config.runTimeoutMs}ms)`,
  );
}

const isMain = process.argv[1]?.endsWith('index.js');
if (isMain) {
  startWorker().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
