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

describe('POST /definitions config parsing', () => {
  it('accepts a valid declarative config and persists the parsed shape', async () => {
    const captured: { config?: unknown } = {};
    const app = createServer(fakePool(captured), queue, storage);

    const res = await request(app)
      .post('/definitions')
      .send({
        name: 'My scrape',
        url: 'https://example.com',
        config: {
          waitFor: '#ready',
          rowSelector: 'table tr',
          fields: [
            { name: 'title', selector: 'td.title' },
            { name: 'href', selector: 'a', attribute: 'href' },
          ],
          artifacts: ['JSON', 'CSV', 'PNG'],
        },
      });

    expect(res.status).toBe(201);
    expect(captured.config).toEqual({
      waitFor: '#ready',
      rowSelector: 'table tr',
      fields: [
        { name: 'title', selector: 'td.title' },
        { name: 'href', selector: 'a', attribute: 'href' },
      ],
      artifacts: ['JSON', 'CSV', 'PNG'],
    });
  });

  it.each([
    { desc: 'empty fields', config: { fields: [], artifacts: ['JSON'] } },
    {
      desc: 'bad artifact type',
      config: { fields: [{ name: 'a', selector: 'b' }], artifacts: ['EXE'] },
    },
    { desc: 'missing selector', config: { fields: [{ name: 'a' }], artifacts: [] } },
  ])('rejects invalid config: $desc', async ({ config }) => {
    const app = createServer(fakePool({}), queue, storage);
    const res = await request(app)
      .post('/definitions')
      .send({ name: 'n', url: 'https://x', config });
    expect(res.status).toBe(400);
  });
});
