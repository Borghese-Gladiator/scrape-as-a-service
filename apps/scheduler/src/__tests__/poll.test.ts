import { describe, it, expect, vi } from 'vitest';
import type { Queue } from 'bullmq';
import type { QueryResult, QueryResultRow } from 'pg';
import type { Queryable } from '@scraper/db';
import type { ScrapeJobData } from '@scraper/shared';
import { pollOnce } from '../poll.js';

interface ScheduleRow extends QueryResultRow {
  id: string;
  definition_id: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  last_run_at: Date | null;
  next_run_at: Date | null;
  created_at: Date;
}

class FakeDb implements Queryable {
  runsCreated: Array<{
    definitionId: string;
    scheduleId: string | null;
    trigger: string;
  }> = [];
  advanced: Array<{ id: string; lastRunAt: Date; nextRunAt: Date }> = [];
  private seq = 0;

  constructor(private readonly schedules: ScheduleRow[]) {}

  async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<QueryResult<R>> {
    const rows = this.dispatch(text, values) as R[];
    return { rows, command: '', rowCount: rows.length, oid: 0, fields: [] };
  }

  private dispatch(text: string, values: unknown[]): unknown[] {
    if (text.includes('FROM scrape_schedules') && text.includes('enabled = TRUE')) {
      const now = values[0] as Date;
      return this.schedules.filter(
        (s) => s.enabled && s.next_run_at !== null && s.next_run_at <= now,
      );
    }
    if (text.includes('INSERT INTO scrape_runs')) {
      this.seq += 1;
      const [definitionId, scheduleId, trigger] = values as [
        string,
        string | null,
        string,
      ];
      this.runsCreated.push({ definitionId, scheduleId, trigger });
      return [{ id: `run-${this.seq}`, definition_id: definitionId }];
    }
    if (text.includes('UPDATE scrape_schedules') && text.includes('last_run_at')) {
      const [id, lastRunAt, nextRunAt] = values as [string, Date, Date];
      this.advanced.push({ id, lastRunAt, nextRunAt });
      return [{ id }];
    }
    throw new Error(`Unhandled query: ${text}`);
  }
}

function fakeQueue() {
  return { add: vi.fn(async () => ({})) } as unknown as Queue<ScrapeJobData>;
}

function schedule(overrides: Partial<ScheduleRow>): ScheduleRow {
  return {
    id: 'sched-1',
    definition_id: 'def-1',
    cron: '*/15 * * * *',
    timezone: 'UTC',
    enabled: true,
    last_run_at: null,
    next_run_at: new Date('2026-01-01T00:00:00Z'),
    created_at: new Date(),
    ...overrides,
  };
}

const NOW = new Date('2026-01-01T00:10:00Z');

describe('pollOnce', () => {
  it('creates a SCHEDULE run, enqueues it, and advances next_run_at for a due enabled schedule', async () => {
    const db = new FakeDb([schedule({})]);
    const queue = fakeQueue();

    const count = await pollOnce({ pool: db, queue, now: NOW });

    expect(count).toBe(1);
    expect(db.runsCreated).toEqual([
      { definitionId: 'def-1', scheduleId: 'sched-1', trigger: 'SCHEDULE' },
    ]);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(db.advanced).toHaveLength(1);
    expect(db.advanced[0]!.lastRunAt).toEqual(NOW);
    // next 15-min boundary strictly after NOW
    expect(db.advanced[0]!.nextRunAt.toISOString()).toBe('2026-01-01T00:15:00.000Z');
  });

  it('does nothing for a disabled schedule', async () => {
    const db = new FakeDb([schedule({ enabled: false })]);
    const queue = fakeQueue();

    const count = await pollOnce({ pool: db, queue, now: NOW });

    expect(count).toBe(0);
    expect(db.runsCreated).toHaveLength(0);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('does nothing for a schedule whose next_run_at is in the future', async () => {
    const db = new FakeDb([schedule({ next_run_at: new Date('2026-01-01T01:00:00Z') })]);
    const queue = fakeQueue();

    const count = await pollOnce({ pool: db, queue, now: NOW });

    expect(count).toBe(0);
    expect(db.runsCreated).toHaveLength(0);
  });
});
