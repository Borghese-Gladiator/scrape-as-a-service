import { closePool, getPool } from '@scraper/db';
import {
  createLogger,
  getQueue,
  getStorage,
  loadConfig,
  onShutdown,
  startHealthServer,
} from '@scraper/shared';
import { pollOnce } from './poll.js';
import { sweepOnce } from './sweep.js';
import { sweepRetention } from './retention.js';

/** The retention sweep is hourly. Nothing it deletes is time-critical. */
const RETENTION_INTERVAL_MS = 3_600_000;

export async function startScheduler(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger('scheduler');
  const pool = getPool(config);
  const queue = getQueue(config);
  const storage = getStorage(config);

  // The in-flight promise is both the overlap guard and the handle shutdown waits on.
  let inFlight: Promise<void> | undefined;

  const tick = async () => {
    try {
      const now = new Date();
      const count = await pollOnce({ pool, queue, now });
      if (count > 0) {
        logger.info({ count }, 'scheduler enqueued runs');
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
      logger.error({ err }, 'scheduler poll failed');
    }
  };

  const timer = setInterval(() => {
    if (inFlight) return;
    inFlight = tick().finally(() => {
      inFlight = undefined;
    });
  }, config.schedulerIntervalMs);

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
        logger.info(
          { runsDeleted: result.runsDeleted, objectsDeleted: result.objectsDeleted },
          'retention sweep deleted runs',
        );
      }
    } catch (err) {
      logger.error({ err }, 'retention sweep failed');
    } finally {
      sweeping = false;
    }
  };
  const retentionTimer = setInterval(() => {
    void sweep();
  }, RETENTION_INTERVAL_MS);
  void sweep();

  const health = await startHealthServer({ port: config.schedulerHealthPort, logger });

  onShutdown(
    async () => {
      clearInterval(timer);
      clearInterval(retentionTimer);
      await inFlight;
      await health.close();
      await queue.close();
      await closePool();
    },
    {
      onSignal: (signal) => {
        logger.info({ signal }, 'scheduler shutting down');
      },
    },
  );

  logger.info(
    {
      intervalMs: config.schedulerIntervalMs,
      healthPort: health.port,
      retentionDays: config.retentionDays,
    },
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
