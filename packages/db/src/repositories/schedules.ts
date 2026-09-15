import type { Queryable } from '../client.js';
import type { CreateScheduleInput, ScrapeSchedule } from '../types.js';

const COLUMNS =
  'id, definition_id, cron, timezone, enabled, last_run_at, next_run_at, catch_up, created_at';

export async function createSchedule(
  db: Queryable,
  input: CreateScheduleInput,
  nextRunAt: Date,
): Promise<ScrapeSchedule | null> {
  const { rows } = await db.query<ScrapeSchedule>(
    `INSERT INTO scrape_schedules (definition_id, cron, timezone, enabled, next_run_at, catch_up)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${COLUMNS}`,
    [
      input.definitionId,
      input.cron,
      input.timezone,
      input.enabled ?? true,
      nextRunAt,
      input.catchUp ?? 'skip',
    ],
  );
  return rows[0] ?? null;
}

export async function listSchedules(
  db: Queryable,
  definitionId?: string,
): Promise<ScrapeSchedule[]> {
  if (definitionId) {
    const { rows } = await db.query<ScrapeSchedule>(
      `SELECT ${COLUMNS} FROM scrape_schedules
       WHERE definition_id = $1 ORDER BY created_at DESC`,
      [definitionId],
    );
    return rows;
  }
  const { rows } = await db.query<ScrapeSchedule>(
    `SELECT ${COLUMNS} FROM scrape_schedules ORDER BY created_at DESC`,
  );
  return rows;
}

export async function setScheduleEnabled(
  db: Queryable,
  id: string,
  enabled: boolean,
): Promise<ScrapeSchedule | null> {
  const { rows } = await db.query<ScrapeSchedule>(
    `UPDATE scrape_schedules SET enabled = $2 WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, enabled],
  );
  return rows[0] ?? null;
}

export async function deleteSchedule(db: Queryable, id: string): Promise<boolean> {
  const { rowCount } = await db.query(`DELETE FROM scrape_schedules WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

/** A schedule whose definition is soft-deleted is never due, so it creates no run. */
export async function findDueSchedules(
  db: Queryable,
  now: Date,
): Promise<ScrapeSchedule[]> {
  const prefixed = COLUMNS.split(', ')
    .map((column) => `s.${column}`)
    .join(', ');
  const { rows } = await db.query<ScrapeSchedule>(
    `SELECT ${prefixed} FROM scrape_schedules s
     JOIN scrape_definitions d ON d.id = s.definition_id
     WHERE s.enabled = TRUE
       AND d.deleted_at IS NULL
       AND s.next_run_at IS NOT NULL
       AND s.next_run_at <= $1
     ORDER BY s.next_run_at ASC`,
    [now],
  );
  return rows;
}

/**
 * Claim one due schedule for this transaction. SKIP LOCKED hands a schedule
 * already claimed by another poller to nobody, so a due schedule produces
 * exactly one run. Must run inside a transaction: the lock is held to COMMIT.
 */
export async function claimDueSchedule(
  db: Queryable,
  now: Date,
): Promise<ScrapeSchedule | null> {
  const { rows } = await db.query<ScrapeSchedule>(
    `SELECT ${COLUMNS} FROM scrape_schedules
     WHERE enabled = TRUE AND next_run_at IS NOT NULL AND next_run_at <= $1
     ORDER BY next_run_at ASC
     LIMIT 1
     FOR UPDATE SKIP LOCKED`,
    [now],
  );
  return rows[0] ?? null;
}

export async function advanceSchedule(
  db: Queryable,
  id: string,
  lastRunAt: Date,
  nextRunAt: Date,
): Promise<ScrapeSchedule | null> {
  const { rows } = await db.query<ScrapeSchedule>(
    `UPDATE scrape_schedules
     SET last_run_at = $2, next_run_at = $3
     WHERE id = $1
     RETURNING ${COLUMNS}`,
    [id, lastRunAt, nextRunAt],
  );
  return rows[0] ?? null;
}
