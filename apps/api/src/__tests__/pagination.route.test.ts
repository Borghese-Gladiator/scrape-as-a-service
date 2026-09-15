import { describe, it, expect } from 'vitest';
import request from 'supertest';
import type { Queue } from 'bullmq';
import type { ScrapeJobData } from '@scraper/shared';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '@scraper/db';
import { createServer } from '../server.js';
import { definitionRow, FakeDb, runRow } from './fake-db.js';

const queue = { add: async () => ({}) } as unknown as Queue<ScrapeJobData>;
const storage = {} as never;

function at(minute: number): Date {
  return new Date(Date.UTC(2026, 0, 1, 0, minute, 0));
}

/** Newest first, so run-0 is the oldest and run-9 the newest. */
function runs(count: number) {
  return Array.from({ length: count }, (_, index) =>
    runRow({
      id: `run-${index}`,
      created_at: at(index),
      status: index % 2 === 0 ? 'SUCCEEDED' : 'FAILED',
    }),
  );
}

function server(db: FakeDb) {
  return createServer(db.asPool(), queue, storage);
}

describe('keyset pagination', () => {
  it('walks every run over two pages, in a stable order, with no repeat', async () => {
    const app = server(new FakeDb({ runs: runs(5) }));

    const first = await request(app).get('/runs?limit=3');
    expect(first.status).toBe(200);
    expect(first.body.items.map((run: { id: string }) => run.id)).toEqual([
      'run-4',
      'run-3',
      'run-2',
    ]);
    expect(first.body.nextCursor).toBeTypeOf('string');

    const second = await request(app).get(
      `/runs?limit=3&cursor=${encodeURIComponent(first.body.nextCursor)}`,
    );
    expect(second.status).toBe(200);
    expect(second.body.items.map((run: { id: string }) => run.id)).toEqual(['run-1', 'run-0']);
    expect(second.body.nextCursor).toBeNull();
  });

  it.each([
    { path: '/runs', key: 'runs' },
    { path: '/definitions', key: 'definitions' },
  ])('clamps the limit of $path to the maximum', async ({ path, key }) => {
    const rows =
      key === 'runs'
        ? { runs: runs(3) }
        : {
            definitions: [
              definitionRow({ id: 'def-1', created_at: at(1) }),
              definitionRow({ id: 'def-2', created_at: at(2) }),
              definitionRow({ id: 'def-3', created_at: at(3) }),
            ],
          };
    const db = new FakeDb(rows);
    const res = await request(server(db)).get(`${path}?limit=9999`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3);
    const last = db.queries[db.queries.length - 1]!;
    expect(last.values[last.values.length - 1]).toBe(MAX_PAGE_LIMIT + 1);
  });

  it('asks for one row past the default limit when no limit is given', async () => {
    const db = new FakeDb({ runs: runs(2) });
    await request(server(db)).get('/runs');

    const last = db.queries[db.queries.length - 1]!;
    expect(last.values[last.values.length - 1]).toBe(DEFAULT_PAGE_LIMIT + 1);
  });

  it('filters runs by status', async () => {
    const res = await request(server(new FakeDb({ runs: runs(5) }))).get('/runs?status=FAILED');

    expect(res.status).toBe(200);
    expect(res.body.items.map((run: { id: string }) => run.id)).toEqual(['run-3', 'run-1']);
  });

  it('rejects an unknown status', async () => {
    const res = await request(server(new FakeDb({ runs: runs(1) }))).get('/runs?status=CANCELLED');

    expect(res.status).toBe(400);
  });

  it('starts at page one when the cursor is unreadable', async () => {
    const res = await request(server(new FakeDb({ runs: runs(3) }))).get('/runs?cursor=not-base64');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3);
  });
});
