import { getPool } from '@scraper/db';
import { createLogger, getQueue, loadConfig, startHealthServer } from '@scraper/shared';
import { pollOnce } from './poll.js';

export async function startScheduler(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger('scheduler');
  const pool = getPool(config);
  const queue = getQueue(config);

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const count = await pollOnce({ pool, queue, now: new Date() });
      if (count > 0) {
        logger.info({ count }, 'scheduler enqueued runs');
      }
    } catch (err) {
      logger.error({ err }, 'scheduler poll failed');
    } finally {
      running = false;
    }
  };

  setInterval(() => {
    void tick();
  }, config.schedulerIntervalMs);

  await startHealthServer({ port: config.schedulerHealthPort, logger });

  logger.info(
    { intervalMs: config.schedulerIntervalMs, healthPort: config.schedulerHealthPort },
    'scheduler started',
  );
}

const isMain = process.argv[1]?.endsWith('index.js');
if (isMain) {
  startScheduler().catch((err) => {
    createLogger('scheduler').fatal({ err }, 'scheduler failed to start');
    process.exit(1);
  });
}
