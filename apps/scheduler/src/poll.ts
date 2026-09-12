import type { Queue } from 'bullmq';
import { advanceSchedule, createRun, findDueSchedules, type Queryable } from '@scraper/db';
import { computeNextRun, enqueueRun, type ScrapeJobData } from '@scraper/shared';

export interface PollDeps {
  pool: Queryable;
  queue: Queue<ScrapeJobData>;
  now: Date;
}

/**
 * Find enabled schedules due at `now`, and for each: create a SCHEDULE run,
 * enqueue it, then advance last_run_at/next_run_at from cron+timezone. Returns
 * the number of runs created. Schedules themselves are never executed directly.
 */
export async function pollOnce(deps: PollDeps): Promise<number> {
  const { pool, queue, now } = deps;
  const due = await findDueSchedules(pool, now);

  let created = 0;
  for (const schedule of due) {
    const run = await createRun(pool, schedule.definition_id, 'SCHEDULE', schedule.id);
    if (!run) {
      throw new Error(`failed to create a run for schedule: ${schedule.id}`);
    }
    await enqueueRun(queue, { runId: run.id, definitionId: schedule.definition_id });
    const nextRunAt = computeNextRun(schedule.cron, schedule.timezone, now);
    await advanceSchedule(pool, schedule.id, now, nextRunAt);
    created += 1;
  }
  return created;
}
