import { getPool } from '@scraper/db';
import { getQueue, getStorage, loadConfig } from '@scraper/shared';
import { pollOnce } from './poll.js';
import { sweepRetention } from './retention.js';

/** The retention sweep is hourly. Nothing it deletes is time-critical. */
const RETENTION_INTERVAL_MS = 3_600_000;

export async function startScheduler(): Promise<void> {
  const config = loadConfig();
  const pool = getPool(config);
  const queue = getQueue(config);
  const storage = getStorage(config);

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

  let sweeping = false;
  const sweep = async () => {
    if (sweeping || config.retentionDays <= 0) return;
    sweeping = true;
    try {
      const result = await sweepRetention({
        pool,
        storage,
        now: new Date(),
        retentionDays: config.retentionDays,
      });
      if (result.runsDeleted > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `retention deleted ${result.runsDeleted} run(s) and ${result.objectsDeleted} object(s)`,
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('retention sweep failed:', err);
    } finally {
      sweeping = false;
    }
  };

  setInterval(() => {
    void tick();
  }, config.schedulerIntervalMs);

  setInterval(() => {
    void sweep();
  }, RETENTION_INTERVAL_MS);
  void sweep();

  // eslint-disable-next-line no-console
  console.log(
    `scheduler started (interval=${config.schedulerIntervalMs}ms, retentionDays=${config.retentionDays})`,
  );
}

const isMain = process.argv[1]?.endsWith('index.js');
if (isMain) {
  startScheduler().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
