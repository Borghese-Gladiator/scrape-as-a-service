import { describe, it, expect } from 'vitest';
import request from 'supertest';
import type { Pool } from 'pg';
import type { Queue } from 'bullmq';
import type { ScrapeJobData } from '@scraper/shared';
import { createServer } from '../server.js';

const pool = {} as unknown as Pool;
const queue = {} as unknown as Queue<ScrapeJobData>;
const storage = {} as never;

describe('GET /openapi.json', () => {
  it('answers with no API key and describes the definitions route', async () => {
    const app = createServer(pool, queue, storage, { apiKey: 'secret' });

    const res = await request(app).get('/openapi.json');

    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.paths['/definitions']).toBeDefined();
    expect(res.body.paths['/definitions'].post).toBeDefined();
  });
});
