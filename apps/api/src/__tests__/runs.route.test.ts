import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import type { Pool } from 'pg';
import type { Queue } from 'bullmq';
import type { QueryResult, QueryResultRow } from 'pg';
import type { ScrapeJobData } from '@scraper/shared';
import { createServer } from '../server.js';

function fakePool(): Pool {
  return {
    async query<R extends QueryResultRow = QueryResultRow>(
      text: string,
      values: unknown[] = [],
    ): Promise<QueryResult<R>> {
      let rows: unknown[] = [];
      if (text.includes('FROM scrape_definitions')) {
        rows = [
          {
            id: 'def-1',
            name: 'd',
            url: 'https://x',
            config: {},
            created_at: new Date(),
          },
        ];
      } else if (text.includes('INSERT INTO scrape_runs')) {
        rows = [
          {
            id: 'run-1',
            definition_id: values[0],
            schedule_id: values[1] ?? null,
            status: 'QUEUED',
            trigger: values[2],
            created_at: new Date(),
            started_at: null,
            finished_at: null,
          },
        ];
      }
      return {
        rows: rows as R[],
        command: '',
        rowCount: rows.length,
        oid: 0,
        fields: [],
      };
    },
  } as unknown as Pool;
}

const storage = {} as never;

describe('POST /runs (manual trigger)', () => {
  it('creates a QUEUED run with trigger MANUAL and enqueues it', async () => {
    const queue = { add: vi.fn(async () => ({})) } as unknown as Queue<ScrapeJobData>;
    const app = createServer(fakePool(), queue, storage);

    const res = await request(app).post('/runs').send({ definitionId: 'def-1' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('QUEUED');
    expect(res.body.trigger).toBe('MANUAL');
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'scrape-run',
      { runId: 'run-1', definitionId: 'def-1' },
      { jobId: 'run-1' },
    );
  });

  it('records the API trigger when the body asks for it', async () => {
    const queue = { add: vi.fn(async () => ({})) } as unknown as Queue<ScrapeJobData>;
    const app = createServer(fakePool(), queue, storage);

    const res = await request(app)
      .post('/runs')
      .send({ definitionId: 'def-1', trigger: 'API' });

    expect(res.status).toBe(201);
    expect(res.body.trigger).toBe('API');
  });

  it.each([
    { desc: 'definitionId is missing', body: {} },
    { desc: 'the trigger is unknown', body: { definitionId: 'def-1', trigger: 'CRON' } },
    {
      desc: 'the trigger is SCHEDULE',
      body: { definitionId: 'def-1', trigger: 'SCHEDULE' },
    },
  ])('returns 400 when $desc', async ({ body }) => {
    const queue = { add: vi.fn() } as unknown as Queue<ScrapeJobData>;
    const app = createServer(fakePool(), queue, storage);

    const res = await request(app).post('/runs').send(body);

    expect(res.status).toBe(400);
    expect(queue.add).not.toHaveBeenCalled();
  });
});
