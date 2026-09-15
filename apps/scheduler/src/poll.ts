import type { Queue } from 'bullmq';
import {
  advanceSchedule,
  claimDueSchedule,
  createRun,
  withTransaction,
  type Connectable,
  type ScrapeSchedule,
} from '@scraper/db';
import { computeNextRun, enqueueRun, type ScrapeJobData } from '@scraper/shared';

export interface PollDeps {
  pool: Connectable;
  queue: Queue<ScrapeJobData>;
  now: Date;
}

/** Upper bound on claims per poll, so one poll cannot loop without end. */
const MAX_CLAIMS_PER_POLL = 100;

export interface SchedulePlan {
  lastRunAt: Date;
  nextRunAt: Date;
}

/**
 * Decide what a claimed schedule records. Both policies produce one run. With
 * 'skip' the run belongs to now and every missed window is forgotten. With
 * 'runOnce' the run belongs to the missed window, and the schedule resumes its
 * cadence from that window. The clamp keeps 'runOnce' to a single catch-up: a
 * next time that is still in the past would replay one window per poll.
 */
export function planSchedule(schedule: ScrapeSchedule, now: Date): SchedulePlan {
  const { cron, timezone } = schedule;
  if (schedule.catch_up === 'runOnce' && schedule.next_run_at !== null) {
    const lastRunAt = schedule.next_run_at;
    const nextRunAt = computeNextRun(cron, timezone, lastRunAt);
    if (nextRunAt > now) {
      return { lastRunAt, nextRunAt };
    }
    return { lastRunAt, nextRunAt: computeNextRun(cron, timezone, now) };
  }
  return { lastRunAt: now, nextRunAt: computeNextRun(cron, timezone, now) };
}

/**
 * Claim each due schedule in its own transaction, create the SCHEDULE run and
 * advance the schedule in that same transaction, then enqueue after the commit
 * so the queue never holds a job for a run that rolled back. Returns the number
 * of runs created. Schedules themselves are never executed directly.
 */
export async function pollOnce(deps: PollDeps): Promise<number> {
  const { pool, queue, now } = deps;

  let created = 0;
  for (let i = 0; i < MAX_CLAIMS_PER_POLL; i += 1) {
    const job = await withTransaction(pool, async (tx) => {
      const schedule = await claimDueSchedule(tx, now);
      if (!schedule) return null;

      const plan = planSchedule(schedule, now);
      const run = await createRun(tx, schedule.definition_id, 'SCHEDULE', schedule.id);
      if (!run) {
        throw new Error(`failed to create a run for schedule: ${schedule.id}`);
      }
      await advanceSchedule(tx, schedule.id, plan.lastRunAt, plan.nextRunAt);
      return { runId: run.id, definitionId: schedule.definition_id };
    });

    if (!job) break;
    await enqueueRun(queue, job);
    created += 1;
  }
  return created;
}
