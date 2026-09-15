import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import type { Pool, QueryResult, QueryResultRow } from 'pg';
import type { Queue } from 'bullmq';
import type { ScrapeJobData } from '@scraper/shared';
import { createServer } from '../server.js';

const API_KEY = 'correct-horse-battery-staple';

function fakePool(): Pool {
  return {
    async query<R extends QueryResultRow = QueryResultRow>(): Promise<QueryResult<R>> {
      return { rows: [] as R[], command: '', rowCount: 0, oid: 0, fields: [] };
    },
  } as unknown as Pool;
}

const storage = {
  presignedGetUrl: vi.fn(async () => 'https://minio.test/object'),
} as never;

function app() {
  const queue = { add: vi.fn(async () => ({})) } as unknown as Queue<ScrapeJobData>;
  return createServer(fakePool(), queue, storage, {
    apiKey: API_KEY,
    assertUrl: async () => {},
  });
}

/** Every route the API mounts. `/health` is the one exemption. */
const ROUTES = [
  { method: 'get', path: '/definitions' },
  { method: 'post', path: '/definitions' },
  { method: 'get', path: '/schedules' },
  { method: 'post', path: '/schedules' },
  { method: 'patch', path: '/schedules/s-1' },
  { method: 'get', path: '/runs' },
  { method: 'get', path: '/runs/run-1' },
  { method: 'post', path: '/runs' },
  { method: 'post', path: '/runs/api-trigger' },
  { method: 'get', path: '/secrets' },
  { method: 'post', path: '/secrets' },
  { method: 'delete', path: '/secrets/sec-1' },
  { method: 'get', path: '/runs/run-1/artifacts' },
  { method: 'get', path: '/artifacts/a-1/url' },
  { method: 'get', path: '/artifacts/a-1/download' },
] as const;

function call(method: string, path: string) {
  const agent = request(app()) as unknown as Record<string, (p: string) => request.Test>;
  return agent[method]!(path);
}

describe('the X-API-Key check', () => {
  it.each(ROUTES)(
    'returns 401 for $method $path with no key',
    async ({ method, path }) => {
      const res = await call(method, path).send({});
      expect(res.status).toBe(401);
    },
  );

  it.each(ROUTES)(
    'returns 401 for $method $path with a wrong key',
    async ({ method, path }) => {
      const res = await call(method, path).set('X-API-Key', 'wrong').send({});
      expect(res.status).toBe(401);
    },
  );

  it.each(ROUTES)(
    'lets $method $path past the check with the right key',
    async ({ method, path }) => {
      const res = await call(method, path).set('X-API-Key', API_KEY).send({});
      expect(res.status).not.toBe(401);
    },
  );

  it.each([
    { desc: 'no key', headers: {} },
    { desc: 'a wrong key', headers: { 'X-API-Key': 'wrong' } },
  ])('returns 200 for /health with $desc', async ({ headers }) => {
    const res = await request(app()).get('/health').set(headers);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('serves every route when no key is configured', async () => {
    const queue = { add: vi.fn() } as unknown as Queue<ScrapeJobData>;
    const open = createServer(fakePool(), queue, storage, { assertUrl: async () => {} });
    const res = await request(open).get('/definitions');
    expect(res.status).toBe(200);
  });
});
