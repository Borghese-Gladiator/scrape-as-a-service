import { describe, it, expect } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import type { Queryable } from '../client.js';
import { createRun, updateRunStatus } from '../repositories/runs.js';
import { insertAttempt, finishAttempt } from '../repositories/attempts.js';
import type { ScrapeRun, ScrapeRunAttempt } from '../types.js';

/**
 * In-memory fake that emulates the subset of SQL our repositories issue.
 * It lets us exercise run/attempt transition logic and attempt numbering
 * against the real typed row shapes without a live Postgres.
 */
class FakeDb implements Queryable {
  runs = new Map<string, ScrapeRun>();
  attempts = new Map<string, ScrapeRunAttempt>();
  private seq = 0;

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<QueryResult<R>> {
    const rows = this.dispatch(text, values) as R[];
    return {
      rows,
      command: '',
      rowCount: rows.length,
      oid: 0,
      fields: [],
    };
  }

  private dispatch(text: string, values: unknown[]): unknown[] {
    if (text.includes('INSERT INTO scrape_runs')) {
      const run: ScrapeRun = {
        id: this.id('run'),
        definition_id: values[0] as string,
        schedule_id: (values[1] as string | null) ?? null,
        status: 'QUEUED',
        trigger: values[2] as ScrapeRun['trigger'],
        created_at: new Date(),
        started_at: null,
        finished_at: null,
      };
      this.runs.set(run.id, run);
      return [run];
    }

    if (text.includes('UPDATE scrape_runs')) {
      const [id, status, at] = values as [string, ScrapeRun['status'], Date];
      const run = this.runs.get(id)!;
      run.status = status;
      if (status === 'RUNNING') run.started_at = at;
      if (status === 'SUCCEEDED' || status === 'FAILED') run.finished_at = at;
      return [run];
    }

    if (text.includes('INSERT INTO scrape_run_attempts')) {
      const [runId, workerId] = values as [string, string];
      const existing = [...this.attempts.values()].filter((a) => a.run_id === runId);
      const attempt: ScrapeRunAttempt = {
        id: this.id('attempt'),
        run_id: runId,
        attempt_number: existing.length + 1,
        status: 'RUNNING',
        worker_id: workerId,
        error_code: null,
        error_message: null,
        started_at: new Date(),
        finished_at: null,
      };
      this.attempts.set(attempt.id, attempt);
      return [attempt];
    }

    if (text.includes('UPDATE scrape_run_attempts')) {
      const [id, status, code, message] = values as [
        string,
        ScrapeRunAttempt['status'],
        string | null,
        string | null,
      ];
      const attempt = this.attempts.get(id)!;
      attempt.status = status;
      attempt.error_code = code;
      attempt.error_message = message;
      attempt.finished_at = new Date();
      return [attempt];
    }

    throw new Error(`Unhandled query: ${text}`);
  }
}

describe('run status transitions', () => {
  it('QUEUED -> RUNNING -> SUCCEEDED stamps started/finished timestamps', async () => {
    const db = new FakeDb();
    const created = await createRun(db, 'def-1', 'MANUAL');
    expect(created.status).toBe('QUEUED');
    expect(created.started_at).toBeNull();

    const startedAt = new Date('2026-01-01T00:00:00Z');
    const running = await updateRunStatus(db, created.id, 'RUNNING', startedAt);
    expect(running.status).toBe('RUNNING');
    expect(running.started_at).toEqual(startedAt);
    expect(running.finished_at).toBeNull();

    const finishedAt = new Date('2026-01-01T00:05:00Z');
    const succeeded = await updateRunStatus(db, created.id, 'SUCCEEDED', finishedAt);
    expect(succeeded.status).toBe('SUCCEEDED');
    expect(succeeded.started_at).toEqual(startedAt);
    expect(succeeded.finished_at).toEqual(finishedAt);
  });

  it('QUEUED -> RUNNING -> FAILED stamps finished_at', async () => {
    const db = new FakeDb();
    const created = await createRun(db, 'def-1', 'SCHEDULE', 'sched-1');
    expect(created.schedule_id).toBe('sched-1');

    await updateRunStatus(db, created.id, 'RUNNING', new Date('2026-01-01T00:00:00Z'));
    const failed = await updateRunStatus(
      db,
      created.id,
      'FAILED',
      new Date('2026-01-01T00:02:00Z'),
    );
    expect(failed.status).toBe('FAILED');
    expect(failed.finished_at).not.toBeNull();
  });
});

describe('attempt insertion and numbering', () => {
  it('assigns incrementing attempt_number per run', async () => {
    const db = new FakeDb();
    const run = await createRun(db, 'def-1', 'API');

    const a1 = await insertAttempt(db, run.id, 'worker-a');
    const a2 = await insertAttempt(db, run.id, 'worker-b');
    const a3 = await insertAttempt(db, run.id, 'worker-a');

    expect(a1.attempt_number).toBe(1);
    expect(a2.attempt_number).toBe(2);
    expect(a3.attempt_number).toBe(3);
    expect(a1.status).toBe('RUNNING');
  });

  it('records error info when an attempt fails', async () => {
    const db = new FakeDb();
    const run = await createRun(db, 'def-1', 'API');
    const attempt = await insertAttempt(db, run.id, 'worker-a');

    const failed = await finishAttempt(db, attempt.id, 'FAILED', {
      code: 'NAV_TIMEOUT',
      message: 'page did not load',
    });
    expect(failed.status).toBe('FAILED');
    expect(failed.error_code).toBe('NAV_TIMEOUT');
    expect(failed.error_message).toBe('page did not load');
    expect(failed.finished_at).not.toBeNull();
  });

  it('numbers attempts independently across runs', async () => {
    const db = new FakeDb();
    const runA = await createRun(db, 'def-1', 'API');
    const runB = await createRun(db, 'def-2', 'API');

    const a1 = await insertAttempt(db, runA.id, 'w');
    const b1 = await insertAttempt(db, runB.id, 'w');
    const a2 = await insertAttempt(db, runA.id, 'w');

    expect(a1.attempt_number).toBe(1);
    expect(b1.attempt_number).toBe(1);
    expect(a2.attempt_number).toBe(2);
  });
});
