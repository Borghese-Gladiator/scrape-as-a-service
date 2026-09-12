import { describe, it, expect, vi } from 'vitest';
import type { Queue } from 'bullmq';
import type { QueryResult, QueryResultRow } from 'pg';
import type { CatchUpPolicy, Connectable, Queryable } from '@scraper/db';
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
  catch_up: CatchUpPolicy;
  created_at: Date;
}

/**
 * Models the one property the poller depends on: a row claimed inside an open
 * transaction is invisible to every other claim until that transaction ends.
 */
class FakeDb implements Connectable {
  runsCreated: Array<{ definitionId: string; scheduleId: string | null; trigger: string }> = [];
  advanced: Array<{ id: string; lastRunAt: Date; nextRunAt: Date }> = [];
  private readonly locked = new Set<string>();
  private seq = 0;

  constructor(private readonly schedules: ScheduleRow[]) {}

  async connect(): Promise<Queryable & { release(): void }> {
    const held = new Set<string>();
    return {
      query: async <R extends QueryResultRow = QueryResultRow>(
        text: string,
        values: unknown[] = [],
      ): Promise<QueryResult<R>> => {
        const rows = this.dispatch(text, values, held) as R[];
        return { rows, command: '', rowCount: rows.length, oid: 0, fields: [] };
      },
      release: () => {
        for (const id of held) this.locked.delete(id);
        held.clear();
      },
    };
  }

  private dispatch(text: string, values: unknown[], held: Set<string>): unknown[] {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return [];

    if (text.includes('FOR UPDATE SKIP LOCKED')) {
      const now = values[0] as Date;
      const row = this.schedules.find(
        (s) =>
          s.enabled &&
          s.next_run_at !== null &&
          s.next_run_at <= now &&
          !this.locked.has(s.id),
      );
      if (!row) return [];
      this.locked.add(row.id);
      held.add(row.id);
      return [row];
    }
    if (text.includes('INSERT INTO scrape_runs')) {
      this.seq += 1;
      const [definitionId, scheduleId, trigger] = values as [string, string | null, string];
      this.runsCreated.push({ definitionId, scheduleId, trigger });
      return [{ id: `run-${this.seq}`, definition_id: definitionId }];
    }
    if (text.includes('UPDATE scrape_schedules') && text.includes('last_run_at')) {
      const [id, lastRunAt, nextRunAt] = values as [string, Date, Date];
      this.advanced.push({ id, lastRunAt, nextRunAt });
      const row = this.schedules.find((s) => s.id === id)!;
      row.last_run_at = lastRunAt;
      row.next_run_at = nextRunAt;
      return [row];
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
    catch_up: 'skip',
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

  it('creates exactly one run when two pollers claim the same schedule at once', async () => {
    const db = new FakeDb([schedule({})]);
    const queue = fakeQueue();

    const counts = await Promise.all([
      pollOnce({ pool: db, queue, now: NOW }),
      pollOnce({ pool: db, queue, now: NOW }),
    ]);

    expect(counts[0]! + counts[1]!).toBe(1);
    expect(db.runsCreated).toHaveLength(1);
    expect(db.advanced).toHaveLength(1);
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('claims every due schedule in one poll', async () => {
    const db = new FakeDb([
      schedule({}),
      schedule({ id: 'sched-2', definition_id: 'def-2' }),
    ]);
    const queue = fakeQueue();

    const count = await pollOnce({ pool: db, queue, now: NOW });

    expect(count).toBe(2);
    expect(db.runsCreated.map((r) => r.scheduleId)).toEqual(['sched-1', 'sched-2']);
  });
});

describe('pollOnce catch-up', () => {
  // The window at 00:00 was missed; the scheduler wakes up 10 hours and 30
  // minutes later, with an hourly cron.
  const MISSED = new Date('2026-01-01T00:00:00Z');
  const LATE = new Date('2026-01-01T10:30:00Z');

  it.each([
    ['skip', 'skip' as CatchUpPolicy, LATE],
    ['runOnce', 'runOnce' as CatchUpPolicy, MISSED],
  ])(
    'with catch_up=%s creates one run and records last_run_at at the right time',
    async (_label, catchUp, expectedLastRunAt) => {
      const db = new FakeDb([
        schedule({ cron: '0 * * * *', next_run_at: MISSED, catch_up: catchUp }),
      ]);
      const queue = fakeQueue();

      const count = await pollOnce({ pool: db, queue, now: LATE });

      expect(count).toBe(1);
      expect(db.advanced).toHaveLength(1);
      expect(db.advanced[0]!.lastRunAt).toEqual(expectedLastRunAt);
      // Both policies resume the cadence ahead of now, so the poll does not
      // replay the remaining missed windows.
      expect(db.advanced[0]!.nextRunAt.toISOString()).toBe('2026-01-01T11:00:00.000Z');
    },
  );

  it('with catch_up=runOnce keeps the cadence when the missed window is the last one', async () => {
    const db = new FakeDb([
      schedule({
        cron: '0 * * * *',
        next_run_at: new Date('2026-01-01T10:00:00Z'),
        catch_up: 'runOnce',
      }),
    ]);
    const queue = fakeQueue();

    const count = await pollOnce({ pool: db, queue, now: LATE });

    expect(count).toBe(1);
    expect(db.advanced[0]!.lastRunAt.toISOString()).toBe('2026-01-01T10:00:00.000Z');
    expect(db.advanced[0]!.nextRunAt.toISOString()).toBe('2026-01-01T11:00:00.000Z');
  });
});
