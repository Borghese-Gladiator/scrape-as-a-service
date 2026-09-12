import type { Queryable } from '../client.js';
import type { AttemptStatus, ScrapeRunAttempt } from '../types.js';

const COLUMNS =
  'id, run_id, attempt_number, status, worker_id, error_code, error_message, started_at, finished_at';

/**
 * Insert a RUNNING attempt for a run, assigning the next incrementing
 * attempt_number atomically via a subquery over existing attempts.
 */
export async function insertAttempt(
  db: Queryable,
  runId: string,
  workerId: string,
): Promise<ScrapeRunAttempt> {
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
  return rows[0]!;
}

export async function finishAttempt(
  db: Queryable,
  id: string,
  status: AttemptStatus,
  error?: { code: string; message: string },
): Promise<ScrapeRunAttempt> {
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
  return rows[0]!;
}

/** Fail every attempt of a run that is still RUNNING. A cancel uses it. */
export async function failRunningAttempts(
  db: Queryable,
  runId: string,
  error: { code: string; message: string },
): Promise<ScrapeRunAttempt[]> {
  const { rows } = await db.query<ScrapeRunAttempt>(
    `UPDATE scrape_run_attempts
     SET status = 'FAILED',
         error_code = $2,
         error_message = $3,
         finished_at = now()
     WHERE run_id = $1 AND status = 'RUNNING'
     RETURNING ${COLUMNS}`,
    [runId, error.code, error.message],
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
