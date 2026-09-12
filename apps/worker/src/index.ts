import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { Worker } from 'bullmq';
import { chromium, type Browser } from 'playwright';
import { closePool, getPool } from '@scraper/db';
import {
  getRedisConnection,
  getStorage,
  loadConfig,
  onShutdown,
  SCRAPE_QUEUE_NAME,
  type ScrapeJobData,
} from '@scraper/shared';
import { processRun } from './process-run.js';

export async function startWorker(): Promise<void> {
  const config = loadConfig();
  const pool = getPool(config);
  const storage = getStorage(config);
  await storage.ensureBucket();

  const workerId = `${hostname()}-${randomUUID()}`;
  const openBrowsers = new Set<Browser>();

  const worker = new Worker<ScrapeJobData>(
    SCRAPE_QUEUE_NAME,
    async (job) => {
      await processRun(job, {
        pool,
        storage,
        workerId,
        launchBrowser: async () => {
          const browser = await chromium.launch();
          openBrowsers.add(browser);
          browser.once('disconnected', () => openBrowsers.delete(browser));
          return browser;
        },
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

  onShutdown(
    async () => {
      // close() drains the active jobs and closes the Redis connection BullMQ owns.
      await worker.close();
      await Promise.all([...openBrowsers].map((browser) => browser.close().catch(() => {})));
      await closePool();
    },
    {
      onSignal: (signal) => {
        // eslint-disable-next-line no-console
        console.log(`worker ${workerId} received ${signal}, shutting down`);
      },
    },
  );

  // eslint-disable-next-line no-console
  console.log(`worker ${workerId} started (concurrency=${config.workerConcurrency})`);
}

const isMain = process.argv[1]?.endsWith('index.js');
if (isMain) {
  startWorker().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
