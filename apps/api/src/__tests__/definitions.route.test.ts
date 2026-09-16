import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import type { Pool, QueryResult, QueryResultRow } from 'pg';
import type { Queue } from 'bullmq';
import type { ScrapeJobData } from '@scraper/shared';
import { createServer } from '../server.js';

function fakePool(captured: { config?: unknown }): Pool {
  return {
    async query<R extends QueryResultRow = QueryResultRow>(
      text: string,
      values: unknown[] = [],
    ): Promise<QueryResult<R>> {
      let rows: unknown[] = [];
      if (text.includes('INSERT INTO scrape_definitions')) {
        captured.config = JSON.parse(values[2] as string);
        rows = [
          {
            id: 'def-1',
            name: values[0],
            url: values[1],
            config: captured.config,
            created_at: new Date(),
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

const queue = { add: vi.fn() } as unknown as Queue<ScrapeJobData>;
const storage = {} as never;

/** Phase 4 added the SSRF guard. Replace it so this suite stays free of DNS. */
const HERMETIC = { assertUrl: async () => {} };

describe('POST /definitions config parsing', () => {
  it('accepts a step program and persists it unchanged', async () => {
    const captured: { config?: unknown } = {};
    const app = createServer(fakePool(captured), queue, storage, HERMETIC);

    const config = {
      steps: [
        { op: 'goto' },
        {
          op: 'paginate',
          nextSelector: 'a.next',
          maxPages: 2,
          steps: [
            {
              op: 'forEach',
              rowSelector: 'tbody tr',
              steps: [
                {
                  op: 'openLink',
                  selector: 'a.receipt',
                  steps: [{ op: 'capture', as: ['PNG'], name: 'receipt-{{index}}' }],
                },
              ],
            },
          ],
        },
      ],
    };

    const res = await request(app)
      .post('/definitions')
      .send({ name: 'Receipts', url: 'https://example.com', config });

    expect(res.status).toBe(201);
    expect(captured.config).toEqual(config);
  });

  it.each([
    { desc: 'no steps array', config: { fields: [{ name: 'a', selector: 'b' }] } },
    {
      desc: 'unknown step verb',
      config: { steps: [{ op: 'evaluate', code: 'alert(1)' }] },
    },
    { desc: 'empty step program', config: { steps: [] } },
  ])('rejects invalid config: $desc', async ({ config }) => {
    const app = createServer(fakePool({}), queue, storage, HERMETIC);
    const res = await request(app)
      .post('/definitions')
      .send({ name: 'n', url: 'https://x', config });
    expect(res.status).toBe(400);
  });
});

describe('POST /definitions URL guard', () => {
  const config = { steps: [{ op: 'goto' }] };

  it.each([
    { desc: 'a link-local address', url: 'http://169.254.169.254/' },
    { desc: 'a private address', url: 'http://10.0.0.1/' },
    { desc: 'loopback', url: 'http://127.0.0.1:9000/' },
    { desc: 'a file URL', url: 'file:///etc/passwd' },
  ])('rejects $desc with 400', async ({ url }) => {
    const captured: { config?: unknown } = {};
    const app = createServer(fakePool(captured), queue, storage);

    const res = await request(app).post('/definitions').send({ name: 'n', url, config });

    expect(res.status).toBe(400);
    expect(captured.config).toBeUndefined();
  });
});
