import { describe, it, expect } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import type { Queryable } from '@scraper/db';
import { sweepOnce } from '../sweep.js';

interface AttemptRow extends QueryResultRow {
  id: string;
  run_id: string;
  status: string;
  error_code: string | null;
  error_message: string | null;
  started_at: Date;
  heartbeat_at: Date | null;
}

const NOW = new Date('2026-01-01T12:00:00Z');
const STALE_MINUTES = 10;

class FakeDb implements Queryable {
  runStatus = new Map<string, string>();

  constructor(readonly attempts: AttemptRow[]) {}

  async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<QueryResult<R>> {
    const rows = this.dispatch(text, values) as R[];
    return { rows, command: '', rowCount: rows.length, oid: 0, fields: [] };
  }

  private dispatch(text: string, values: unknown[]): unknown[] {
    if (text.includes('FROM scrape_run_attempts')) {
      const threshold = values[0] as Date;
      return this.attempts.filter(
        (a) => a.status === 'RUNNING' && (a.heartbeat_at ?? a.started_at) < threshold,
      );
    }
    if (text.includes('UPDATE scrape_run_attempts')) {
      const [id, status, code, message] = values as [
        string,
        string,
        string | null,
        string | null,
      ];
      const attempt = this.attempts.find((a) => a.id === id)!;
      attempt.status = status;
      attempt.error_code = code;
      attempt.error_message = message;
      return [attempt];
    }
    if (text.includes('UPDATE scrape_runs')) {
      const [id, status] = values as [string, string];
      this.runStatus.set(id, status);
      return [{ id, status }];
    }
    throw new Error(`Unhandled query: ${text}`);
  }
}

function attempt(overrides: Partial<AttemptRow>): AttemptRow {
  return {
    id: 'attempt-1',
    run_id: 'run-1',
    status: 'RUNNING',
    error_code: null,
    error_message: null,
    started_at: NOW,
    heartbeat_at: null,
    ...overrides,
  };
}

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000);
}

describe('sweepOnce', () => {
  it.each([
    ['a recent heartbeat', { heartbeat_at: minutesAgo(2), started_at: minutesAgo(90) }],
    ['a recent start and no heartbeat', { started_at: minutesAgo(2) }],
  ])('leaves an attempt inside the window alone: %s', async (_label, fields) => {
    const db = new FakeDb([attempt(fields)]);

    const swept = await sweepOnce({
      pool: db,
      now: NOW,
      staleAttemptMinutes: STALE_MINUTES,
    });

    expect(swept).toBe(0);
    expect(db.attempts[0]!.status).toBe('RUNNING');
    expect(db.runStatus.size).toBe(0);
  });

  it.each([
    ['an old heartbeat', { heartbeat_at: minutesAgo(30), started_at: minutesAgo(2) }],
    ['an old start and no heartbeat', { started_at: minutesAgo(30) }],
  ])('fails an attempt outside the window and its run: %s', async (_label, fields) => {
    const db = new FakeDb([attempt(fields)]);

    const swept = await sweepOnce({
      pool: db,
      now: NOW,
      staleAttemptMinutes: STALE_MINUTES,
    });

    expect(swept).toBe(1);
    expect(db.attempts[0]!.status).toBe('FAILED');
    expect(db.attempts[0]!.error_code).toBe('STALE');
    expect(db.runStatus.get('run-1')).toBe('FAILED');
  });

  it('leaves an attempt that already finished alone', async () => {
    const db = new FakeDb([
      attempt({ status: 'SUCCEEDED', started_at: minutesAgo(120) }),
    ]);

    const swept = await sweepOnce({
      pool: db,
      now: NOW,
      staleAttemptMinutes: STALE_MINUTES,
    });

    expect(swept).toBe(0);
    expect(db.runStatus.size).toBe(0);
  });
});
