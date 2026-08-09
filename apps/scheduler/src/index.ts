import { getPool } from '@scraper/db';
import { getQueue, loadConfig } from '@scraper/shared';
import { pollOnce } from './poll.js';

export async function startScheduler(): Promise<void> {
  const config = loadConfig();
  const pool = getPool(config);
  const queue = getQueue(config);

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const count = await pollOnce({ pool, queue, now: new Date() });
      if (count > 0) {
        // eslint-disable-next-line no-console
        console.log(`scheduler enqueued ${count} run(s)`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('scheduler poll failed:', err);
    } finally {
      running = false;
    }
  };

  setInterval(() => {
    void tick();
  }, config.schedulerIntervalMs);

  // eslint-disable-next-line no-console
  console.log(`scheduler started (interval=${config.schedulerIntervalMs}ms)`);
}

const isMain = process.argv[1]?.endsWith('index.js');
if (isMain) {
  startScheduler().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
