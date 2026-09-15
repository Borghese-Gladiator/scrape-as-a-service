import type { Queryable } from '../client.js';
import type { AttemptStatus, ScrapeRunAttempt } from '../types.js';

const COLUMNS =
  'id, run_id, attempt_number, status, worker_id, error_code, error_message, started_at, heartbeat_at, finished_at';

/**
 * Insert a RUNNING attempt for a run, assigning the next incrementing
 * attempt_number atomically via a subquery over existing attempts.
 */
export async function insertAttempt(
  db: Queryable,
  runId: string,
  workerId: string,
): Promise<ScrapeRunAttempt | null> {
  const { rows } = await db.query<ScrapeRunAttempt>(
    `INSERT INTO scrape_run_attempts (run_id, attempt_number, status, worker_id)
     VALUES (
       $1,
       (SELECT COALESCE(MAX(attempt_number), 0) + 1
          FROM scrape_run_attempts WHERE run_id = $1),
       'RUNNING',
       $2
     )
     RETURNING ${COLUMNS}`,
    [runId, workerId],
  );
  return rows[0] ?? null;
}

export async function finishAttempt(
  db: Queryable,
  id: string,
  status: AttemptStatus,
  error?: { code: string; message: string },
): Promise<ScrapeRunAttempt | null> {
  const { rows } = await db.query<ScrapeRunAttempt>(
    `UPDATE scrape_run_attempts
     SET status = $2,
         error_code = $3,
         error_message = $4,
         finished_at = now()
     WHERE id = $1
     RETURNING ${COLUMNS}`,
    [id, status, error?.code ?? null, error?.message ?? null],
  );
  return rows[0] ?? null;
}

/** Record liveness on a RUNNING attempt so the stale sweeper leaves it alone. */
export async function touchAttempt(db: Queryable, id: string): Promise<void> {
  await db.query(
    `UPDATE scrape_run_attempts SET heartbeat_at = now() WHERE id = $1 AND status = 'RUNNING'`,
    [id],
  );
}

export interface StaleAttempt {
  id: string;
  run_id: string;
  started_at: Date;
  heartbeat_at: Date | null;
}

/**
 * RUNNING attempts whose last sign of life is older than `threshold`. An
 * attempt that never beat falls back to started_at.
 */
export async function findStaleAttempts(
  db: Queryable,
  threshold: Date,
): Promise<StaleAttempt[]> {
  const { rows } = await db.query<StaleAttempt>(
    `SELECT id, run_id, started_at, heartbeat_at
       FROM scrape_run_attempts
      WHERE status = 'RUNNING'
        AND COALESCE(heartbeat_at, started_at) < $1
      ORDER BY started_at ASC`,
    [threshold],
  );
  return rows;
}

export async function listAttempts(
  db: Queryable,
  runId: string,
): Promise<ScrapeRunAttempt[]> {
  const { rows } = await db.query<ScrapeRunAttempt>(
    `SELECT ${COLUMNS} FROM scrape_run_attempts
     WHERE run_id = $1 ORDER BY attempt_number ASC`,
    [runId],
  );
  return rows;
}
