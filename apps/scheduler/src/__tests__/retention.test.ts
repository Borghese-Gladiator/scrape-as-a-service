import { describe, it, expect } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import type { Queryable } from '@scraper/db';
import type { StorageClient } from '@scraper/shared';
import { sweepRetention } from '../retention.js';

interface RunRow extends QueryResultRow {
  id: string;
  created_at: Date;
}

interface ArtifactRow extends QueryResultRow {
  id: string;
  run_id: string;
  object_key: string;
}

const NOW = new Date('2026-03-01T00:00:00Z');

class FakeDb implements Queryable {
  constructor(
    readonly runs: RunRow[],
    readonly artifacts: ArtifactRow[],
    readonly events: string[],
  ) {}

  async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<QueryResult<R>> {
    const rows = this.dispatch(text, values) as R[];
    return { rows, command: '', rowCount: rows.length, oid: 0, fields: [] };
  }

  private dispatch(text: string, values: unknown[]): QueryResultRow[] {
    if (text.includes('FROM scrape_runs') && text.includes('created_at < $1')) {
      const before = values[0] as Date;
      return this.runs
        .filter((run) => run.created_at < before)
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
        .slice(0, values[1] as number);
    }
    if (text.includes('FROM artifacts')) {
      return this.artifacts.filter((artifact) => artifact.run_id === values[0]);
    }
    if (text.includes('DELETE FROM scrape_runs')) {
      const index = this.runs.findIndex((run) => run.id === values[0]);
      if (index === -1) return [];
      this.events.push(`delete-run:${values[0] as string}`);
      this.runs.splice(index, 1);
      return [{ id: values[0] as string }];
    }
    throw new Error(`Unhandled query: ${text}`);
  }
}

function fakeStorage(events: string[]): StorageClient {
  return {
    async remove(objectKey: string) {
      events.push(`remove:${objectKey}`);
    },
  } as unknown as StorageClient;
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 86_400_000);
}

function fixture(events: string[]) {
  const runs: RunRow[] = [
    { id: 'old-run', created_at: daysAgo(40) },
    { id: 'fresh-run', created_at: daysAgo(2) },
  ];
  const artifacts: ArtifactRow[] = [
    { id: 'a1', run_id: 'old-run', object_key: 'runs/old-run/one.png' },
    { id: 'a2', run_id: 'old-run', object_key: 'runs/old-run/two.png' },
    { id: 'a3', run_id: 'fresh-run', object_key: 'runs/fresh-run/one.png' },
  ];
  return new FakeDb(runs, artifacts, events);
}

describe('sweepRetention', () => {
  it('removes every object before it deletes the row, and keeps a run inside the window', async () => {
    const events: string[] = [];
    const db = fixture(events);

    const result = await sweepRetention({
      pool: db,
      storage: fakeStorage(events),
      now: NOW,
      retentionDays: 30,
    });

    expect(result).toEqual({ runsDeleted: 1, objectsDeleted: 2 });
    expect(events).toEqual([
      'remove:runs/old-run/one.png',
      'remove:runs/old-run/two.png',
      'delete-run:old-run',
    ]);
    expect(db.runs.map((run) => run.id)).toEqual(['fresh-run']);
  });

  it.each([
    { retentionDays: 0, desc: 'zero disables the sweeper' },
    { retentionDays: 365, desc: 'a long window keeps every run' },
  ])('deletes nothing when $desc', async ({ retentionDays }) => {
    const events: string[] = [];
    const db = fixture(events);

    const result = await sweepRetention({
      pool: db,
      storage: fakeStorage(events),
      now: NOW,
      retentionDays,
    });

    expect(result).toEqual({ runsDeleted: 0, objectsDeleted: 0 });
    expect(events).toEqual([]);
    expect(db.runs).toHaveLength(2);
  });

  it('takes at most `limit` runs in one sweep', async () => {
    const events: string[] = [];
    const db = new FakeDb(
      [
        { id: 'run-a', created_at: daysAgo(90) },
        { id: 'run-b', created_at: daysAgo(80) },
        { id: 'run-c', created_at: daysAgo(70) },
      ],
      [],
      events,
    );

    const result = await sweepRetention({
      pool: db,
      storage: fakeStorage(events),
      now: NOW,
      retentionDays: 30,
      limit: 2,
    });

    expect(result.runsDeleted).toBe(2);
    expect(db.runs.map((run) => run.id)).toEqual(['run-c']);
  });
});
