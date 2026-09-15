import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import type { Pool } from 'pg';
import type { Queue } from 'bullmq';
import type { ScrapeJobData } from '@scraper/shared';
import { createServer } from '../server.js';

const pool = {} as Pool;
const queue = { add: vi.fn() } as unknown as Queue<ScrapeJobData>;
const storage = {} as never;

const ALLOWED = 'http://localhost:3000';

describe('CORS preflight on /definitions', () => {
  it('allows an origin from the allowlist', async () => {
    const app = createServer(pool, queue, storage, { corsOrigins: [ALLOWED] });

    const res = await request(app)
      .options('/definitions')
      .set('Origin', ALLOWED)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
  });

  it.each([
    { desc: 'another port', origin: 'http://localhost:9999' },
    { desc: 'another host', origin: 'https://evil.example.com' },
  ])('sends no allow-origin header for $desc', async ({ origin }) => {
    const app = createServer(pool, queue, storage, { corsOrigins: [ALLOWED] });

    const res = await request(app)
      .options('/definitions')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
