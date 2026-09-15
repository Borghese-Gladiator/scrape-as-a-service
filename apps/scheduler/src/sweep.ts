import {
  finishAttempt,
  findStaleAttempts,
  updateRunStatus,
  type Queryable,
} from '@scraper/db';

export interface SweepDeps {
  pool: Queryable;
  now: Date;
  staleAttemptMinutes: number;
}

/**
 * Close out attempts that stopped reporting. A worker that dies mid-job leaves
 * its attempt and its run RUNNING for ever, because nothing else writes a
 * terminal status. Returns the number of attempts failed.
 */
export async function sweepOnce(deps: SweepDeps): Promise<number> {
  const { pool, now, staleAttemptMinutes } = deps;
  const threshold = new Date(now.getTime() - staleAttemptMinutes * 60_000);

  const stale = await findStaleAttempts(pool, threshold);
  for (const attempt of stale) {
    await finishAttempt(pool, attempt.id, 'FAILED', {
      code: 'STALE',
      message: `attempt reported no heartbeat for more than ${staleAttemptMinutes} minute(s)`,
    });
    await updateRunStatus(pool, attempt.run_id, 'FAILED', now);
  }
  return stale.length;
}
