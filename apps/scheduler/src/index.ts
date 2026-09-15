import { closePool, getPool } from '@scraper/db';
import { getQueue, loadConfig, onShutdown } from '@scraper/shared';
import { pollOnce } from './poll.js';
import { sweepOnce } from './sweep.js';

export async function startScheduler(): Promise<void> {
  const config = loadConfig();
  const pool = getPool(config);
  const queue = getQueue(config);

  // The in-flight promise is both the overlap guard and the handle shutdown waits on.
  let inFlight: Promise<void> | undefined;

  const tick = async () => {
    try {
      const now = new Date();
      const count = await pollOnce({ pool, queue, now });
      if (count > 0) {
        // eslint-disable-next-line no-console
        console.log(`scheduler enqueued ${count} run(s)`);
      }
      const swept = await sweepOnce({
        pool,
        now,
        staleAttemptMinutes: config.staleAttemptMinutes,
      });
      if (swept > 0) {
        // eslint-disable-next-line no-console
        console.log(`scheduler failed ${swept} stale attempt(s)`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('scheduler poll failed:', err);
    }
  };

  const timer = setInterval(() => {
    if (inFlight) return;
    inFlight = tick().finally(() => {
      inFlight = undefined;
    });
  }, config.schedulerIntervalMs);

  onShutdown(
    async () => {
      clearInterval(timer);
      await inFlight;
      await queue.close();
      await closePool();
    },
    {
      onSignal: (signal) => {
        // eslint-disable-next-line no-console
        console.log(`scheduler received ${signal}, shutting down`);
      },
    },
  );

  // eslint-disable-next-line no-console
  console.log(
    `scheduler started (interval=${config.schedulerIntervalMs}ms, stale=${config.staleAttemptMinutes}m)`,
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
