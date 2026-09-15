import { randomBytes } from 'node:crypto';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import type { Pool, QueryResult, QueryResultRow } from 'pg';
import type { Queue } from 'bullmq';
import type { ScrapeJobData } from '@scraper/shared';
import { createServer } from '../server.js';

const PLAINTEXT = 'super-secret-court-password';
const SECRET_NAME = 'court_pw';
const SECRET_ID = '11111111-1111-1111-1111-111111111111';

beforeAll(() => {
  process.env.SECRET_ENCRYPTION_KEY = randomBytes(32).toString('base64');
});

/**
 * A pool that stores what the API writes, so a test can assert on the stored
 * ciphertext as well as on every response body.
 */
function fakePool(stored: { ciphertext?: string }): Pool {
  const now = new Date();
  return {
    async query<R extends QueryResultRow = QueryResultRow>(
      text: string,
      values: unknown[] = [],
    ): Promise<QueryResult<R>> {
      let rows: unknown[] = [];
      if (text.includes('INSERT INTO secrets')) {
        stored.ciphertext = values[1] as string;
        rows = [{ id: SECRET_ID, name: values[0], created_at: now, updated_at: now }];
      } else if (text.includes('FROM secrets')) {
        rows = [{ id: SECRET_ID, name: SECRET_NAME, created_at: now, updated_at: now }];
      } else if (text.includes('FROM scrape_definitions')) {
        rows = [
          {
            id: 'def-1',
            name: 'Receipts',
            url: 'https://example.com',
            config: {
              version: 2,
              auth: { mode: 'storageState', secretRef: SECRET_NAME },
              steps: [
                { op: 'goto' },
                { op: 'fill', selector: '#pw', valueFrom: SECRET_NAME },
              ],
            },
            created_at: now,
          },
        ];
      } else if (text.includes('FROM scrape_runs')) {
        rows = [
          {
            id: 'run-1',
            definition_id: 'def-1',
            schedule_id: null,
            status: 'SUCCEEDED',
            trigger: 'MANUAL',
            created_at: now,
            started_at: now,
            finished_at: now,
          },
        ];
      }
      return { rows: rows as R[], command: '', rowCount: rows.length, oid: 0, fields: [] };
    },
  } as unknown as Pool;
}

function app(stored: { ciphertext?: string } = {}) {
  const queue = { add: vi.fn(async () => ({})) } as unknown as Queue<ScrapeJobData>;
  return createServer(fakePool(stored), queue, {} as never, { assertUrl: async () => {} });
}

describe('POST /secrets', () => {
  it('stores a ciphertext and returns metadata only', async () => {
    const stored: { ciphertext?: string } = {};
    const res = await request(app(stored))
      .post('/secrets')
      .send({ name: SECRET_NAME, value: PLAINTEXT });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: SECRET_ID, name: SECRET_NAME });
    expect(stored.ciphertext).toBeDefined();
    expect(stored.ciphertext).not.toContain(PLAINTEXT);
    expect(JSON.stringify(res.body)).not.toContain(PLAINTEXT);
    expect(JSON.stringify(res.body)).not.toContain(stored.ciphertext);
  });

  it.each([
    { desc: 'no name', body: { value: PLAINTEXT } },
    { desc: 'an empty name', body: { name: '', value: PLAINTEXT } },
    { desc: 'a name with a slash', body: { name: 'a/b', value: PLAINTEXT } },
    { desc: 'no value', body: { name: SECRET_NAME } },
    { desc: 'an empty value', body: { name: SECRET_NAME, value: '' } },
  ])('rejects a request with $desc', async ({ body }) => {
    const res = await request(app()).post('/secrets').send(body);
    expect(res.status).toBe(400);
  });
});

describe('no response body carries a plaintext secret', () => {
  it.each([
    { desc: 'GET /secrets', path: '/secrets' },
    { desc: 'GET /definitions', path: '/definitions' },
    { desc: 'GET /runs/:id', path: '/runs/run-1' },
  ])('$desc', async ({ path }) => {
    const stored: { ciphertext?: string } = {};
    const server = app(stored);
    await request(server).post('/secrets').send({ name: SECRET_NAME, value: PLAINTEXT });

    const res = await request(server).get(path);
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(PLAINTEXT);
    expect(body).not.toContain('ciphertext');
    expect(body).not.toContain(stored.ciphertext);
  });
});

describe('DELETE /secrets/:id', () => {
  it('returns 204 when the row existed', async () => {
    const res = await request(app()).delete(`/secrets/${SECRET_ID}`);
    expect(res.status).toBe(204);
  });
});
