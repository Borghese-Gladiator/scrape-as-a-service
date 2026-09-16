import { describe, it, expect } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import type { Queryable } from '../client.js';
import { updateRunStatus } from '../repositories/runs.js';
import type { ScrapeRun } from '../types.js';

/**
 * The fake client honours COALESCE(started_at, $3) by reading the SQL text, so
 * the behavioural assertion below fails if the repository drops the COALESCE.
 */
class FakeDb implements Queryable {
  sql: string[] = [];
  run: ScrapeRun = {
    id: 'run-1',
    definition_id: 'def-1',
    status: 'QUEUED',
    trigger: 'MANUAL',
    created_at: new Date('2026-01-01T00:00:00Z'),
    started_at: null,
    finished_at: null,
  };

  async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<QueryResult<R>> {
    this.sql.push(text);
    const [, status, at] = values as [string, ScrapeRun['status'], Date];
    this.run.status = status;
    if (status === 'RUNNING') {
      const coalesces = text.includes('COALESCE(started_at, $3)');
      this.run.started_at = coalesces ? (this.run.started_at ?? at) : at;
    }
    if (status === 'SUCCEEDED' || status === 'FAILED') this.run.finished_at = at;
    return {
      rows: [this.run] as unknown as R[],
      command: '',
      rowCount: 1,
      oid: 0,
      fields: [],
    };
  }
}

const FIRST_START = new Date('2026-01-01T00:01:00Z');
const RETRY_START = new Date('2026-01-01T00:09:00Z');

describe('updateRunStatus started_at', () => {
  it('sends COALESCE so an existing start time is kept', async () => {
    const db = new FakeDb();

    await updateRunStatus(db, 'run-1', 'RUNNING', FIRST_START);

    expect(db.sql[0]).toContain('COALESCE(started_at, $3)');
  });

  it('keeps the first start time across a second RUNNING transition', async () => {
    const db = new FakeDb();

    const first = await updateRunStatus(db, 'run-1', 'RUNNING', FIRST_START);
    expect(first?.started_at).toEqual(FIRST_START);

    const retry = await updateRunStatus(db, 'run-1', 'RUNNING', RETRY_START);
    expect(retry?.started_at).toEqual(FIRST_START);
  });

  it('leaves started_at alone on a terminal transition', async () => {
    const db = new FakeDb();
    await updateRunStatus(db, 'run-1', 'RUNNING', FIRST_START);

    const finishedAt = new Date('2026-01-01T00:12:00Z');
    const succeeded = await updateRunStatus(db, 'run-1', 'SUCCEEDED', finishedAt);

    expect(succeeded?.started_at).toEqual(FIRST_START);
    expect(succeeded?.finished_at).toEqual(finishedAt);
  });
});
