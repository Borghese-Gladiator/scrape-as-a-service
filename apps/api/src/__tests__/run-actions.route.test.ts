import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import type { Queue } from 'bullmq';
import type { ScrapeJobData } from '@scraper/shared';
import { createServer } from '../server.js';
import { definitionRow, FakeDb, runRow, type AttemptRow } from './fake-db.js';

const storage = {} as never;

function queue() {
  return {
    add: vi.fn(async () => ({})),
    remove: vi.fn(async () => 1),
  } as unknown as Queue<ScrapeJobData>;
}

function attempt(overrides: Partial<AttemptRow> = {}): AttemptRow {
  return {
    id: 'attempt-1',
    run_id: 'run-1',
    attempt_number: 1,
    status: 'RUNNING',
    worker_id: 'worker-1',
    error_code: null,
    error_message: null,
    started_at: new Date('2026-01-01T00:00:00Z'),
    finished_at: null,
    ...overrides,
  };
}

describe('POST /runs/:id/cancel', () => {
  it.each([
    { desc: 'a QUEUED run', status: 'QUEUED', attempts: [] as AttemptRow[] },
    { desc: 'a RUNNING run', status: 'RUNNING', attempts: [attempt()] },
  ])(
    'cancels $desc as FAILED with the error code CANCELLED',
    async ({ status, attempts }) => {
      const db = new FakeDb({
        definitions: [definitionRow()],
        runs: [runRow({ id: 'run-1', status })],
        attempts,
      });
      const jobQueue = queue();
      const app = createServer(db.asPool(), jobQueue, storage);

      const res = await request(app).post('/runs/run-1/cancel');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('FAILED');
      expect(jobQueue.remove).toHaveBeenCalledWith('run-1');
      expect(db.runs[0]!.status).toBe('FAILED');
      expect(db.attempts).toHaveLength(1);
      expect(db.attempts[0]).toMatchObject({ status: 'FAILED', error_code: 'CANCELLED' });
    },
  );

  it.each([{ status: 'SUCCEEDED' }, { status: 'FAILED' }])(
    'returns 409 for a run that is already $status',
    async ({ status }) => {
      const db = new FakeDb({ runs: [runRow({ id: 'run-1', status })] });
      const jobQueue = queue();
      const app = createServer(db.asPool(), jobQueue, storage);

      const res = await request(app).post('/runs/run-1/cancel');

      expect(res.status).toBe(409);
      expect(jobQueue.remove).not.toHaveBeenCalled();
    },
  );

  it('returns 404 for an unknown run', async () => {
    const app = createServer(new FakeDb().asPool(), queue(), storage);

    expect((await request(app).post('/runs/missing/cancel')).status).toBe(404);
  });
});

describe('POST /runs/:id/rerun', () => {
  it('creates and enqueues a second run from the same definition', async () => {
    const db = new FakeDb({
      definitions: [definitionRow({ id: 'def-1' })],
      runs: [runRow({ id: 'run-1', definition_id: 'def-1', status: 'FAILED' })],
    });
    const jobQueue = queue();
    const app = createServer(db.asPool(), jobQueue, storage);

    const res = await request(app).post('/runs/run-1/rerun');

    expect(res.status).toBe(201);
    expect(res.body.definition_id).toBe('def-1');
    expect(res.body.id).not.toBe('run-1');
    expect(res.body.status).toBe('QUEUED');
    expect(jobQueue.add).toHaveBeenCalledTimes(1);
  });

  it.each([
    { desc: 'an unknown run', runId: 'missing', deleted: false, status: 404 },
    { desc: 'a deleted definition', runId: 'run-1', deleted: true, status: 409 },
  ])('returns $status for $desc', async ({ runId, deleted, status }) => {
    const db = new FakeDb({
      definitions: [
        definitionRow({ id: 'def-1', deleted_at: deleted ? new Date() : null }),
      ],
      runs: [runRow({ id: 'run-1', definition_id: 'def-1' })],
    });
    const jobQueue = queue();
    const app = createServer(db.asPool(), jobQueue, storage);

    const res = await request(app).post(`/runs/${runId}/rerun`);

    expect(res.status).toBe(status);
    expect(jobQueue.add).not.toHaveBeenCalled();
  });
});
