import type { Queryable } from '../client.js';
import { decodeCursor, resolveLimit, toPage } from '../pagination.js';
import type { Page, PageQuery, RunDetail, RunStatus, RunTrigger, ScrapeRun } from '../types.js';
import { listAttempts } from './attempts.js';
import { listArtifacts } from './artifacts.js';

const COLUMNS =
  'id, definition_id, schedule_id, status, trigger, created_at, started_at, finished_at';

export async function createRun(
  db: Queryable,
  definitionId: string,
  trigger: RunTrigger,
  scheduleId: string | null = null,
): Promise<ScrapeRun | null> {
  const { rows } = await db.query<ScrapeRun>(
    `INSERT INTO scrape_runs (definition_id, schedule_id, status, trigger)
     VALUES ($1, $2, 'QUEUED', $3)
     RETURNING ${COLUMNS}`,
    [definitionId, scheduleId, trigger],
  );
  return rows[0] ?? null;
}

/**
 * COALESCE keeps the first start time. A retry transitions the run to RUNNING
 * again, and the total duration must measure from the first attempt.
 */
export async function updateRunStatus(
  db: Queryable,
  id: string,
  status: RunStatus,
  at: Date,
): Promise<ScrapeRun | null> {
  const { rows } = await db.query<ScrapeRun>(
    `UPDATE scrape_runs
     SET status = $2::run_status,
         started_at = CASE WHEN $2 = 'RUNNING' THEN COALESCE(started_at, $3) ELSE started_at END,
         finished_at = CASE WHEN $2 IN ('SUCCEEDED', 'FAILED') THEN $3 ELSE finished_at END
     WHERE id = $1
     RETURNING ${COLUMNS}`,
    [id, status, at],
  );
  return rows[0] ?? null;
}

export async function getRun(db: Queryable, id: string): Promise<ScrapeRun | null> {
  const { rows } = await db.query<ScrapeRun>(
    `SELECT ${COLUMNS} FROM scrape_runs WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function getRunDetail(
  db: Queryable,
  id: string,
): Promise<RunDetail | null> {
  const run = await getRun(db, id);
  if (!run) return null;
  const [attempts, artifacts] = await Promise.all([
    listAttempts(db, id),
    listArtifacts(db, id),
  ]);
  return { ...run, attempts, artifacts };
}

export interface ListRunsQuery extends PageQuery {
  definitionId?: string;
  status?: RunStatus;
}

/** One keyset page of runs, newest first, with an optional status filter. */
export async function listRuns(
  db: Queryable,
  query: ListRunsQuery = {},
): Promise<Page<ScrapeRun>> {
  const limit = resolveLimit(query.limit);
  const cursor = decodeCursor(query.cursor);
  const values: unknown[] = [];
  const where: string[] = [];

  if (query.definitionId !== undefined) {
    values.push(query.definitionId);
    where.push(`definition_id = $${values.length}`);
  }
  if (query.status !== undefined) {
    values.push(query.status);
    where.push(`status = $${values.length}::run_status`);
  }
  if (cursor) {
    values.push(cursor.createdAt, cursor.id);
    where.push(`(created_at, id) < ($${values.length - 1}, $${values.length})`);
  }
  values.push(limit + 1);

  const { rows } = await db.query<ScrapeRun>(
    `SELECT ${COLUMNS} FROM scrape_runs
     ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC, id DESC
     LIMIT $${values.length}`,
    values,
  );
  return toPage(rows, limit);
}

/** Oldest first, so the retention sweeper always makes progress. */
export async function findRunsOlderThan(
  db: Queryable,
  before: Date,
  limit: number,
): Promise<ScrapeRun[]> {
  const { rows } = await db.query<ScrapeRun>(
    `SELECT ${COLUMNS} FROM scrape_runs
     WHERE created_at < $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [before, limit],
  );
  return rows;
}

/** The artifact rows of the run go with it through ON DELETE CASCADE. */
export async function deleteRun(db: Queryable, id: string): Promise<boolean> {
  const { rowCount } = await db.query(`DELETE FROM scrape_runs WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}
