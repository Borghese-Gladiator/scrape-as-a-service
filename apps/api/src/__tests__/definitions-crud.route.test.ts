import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import type { Queue } from 'bullmq';
import type { ScrapeJobData } from '@scraper/shared';
import { createServer } from '../server.js';
import { definitionRow, FakeDb } from './fake-db.js';

const storage = {} as never;

function queue() {
  return { add: vi.fn(async () => ({})) } as unknown as Queue<ScrapeJobData>;
}

function db() {
  return new FakeDb({ definitions: [definitionRow({ id: 'def-1' })] });
}

describe('GET /definitions/:id', () => {
  it('returns the definition instead of the whole list', async () => {
    const app = createServer(db().asPool(), queue(), storage);

    const res = await request(app).get('/definitions/def-1');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('def-1');
  });

  it('returns 404 for an unknown id', async () => {
    const app = createServer(new FakeDb().asPool(), queue(), storage);

    const res = await request(app).get('/definitions/missing');

    expect(res.status).toBe(404);
  });
});

describe('PUT /definitions/:id', () => {
  it('updates the name and stores the validated config', async () => {
    const fake = db();
    const app = createServer(fake.asPool(), queue(), storage);

    const res = await request(app)
      .put('/definitions/def-1')
      .send({
        name: 'Renamed',
        config: { version: 2, steps: [{ op: 'goBack' }] },
      });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Renamed');
    expect(fake.definitions[0]!.config).toEqual({ version: 2, steps: [{ op: 'goBack' }] });
  });

  it.each([
    { desc: 'an invalid config', body: { config: { version: 2, steps: [{ op: 'evaluate' }] } } },
    { desc: 'an empty body', body: {} },
    { desc: 'an empty name', body: { name: '' } },
  ])('rejects $desc', async ({ body }) => {
    const app = createServer(db().asPool(), queue(), storage);

    const res = await request(app).put('/definitions/def-1').send(body);

    expect(res.status).toBe(400);
  });
});

describe('DELETE /definitions/:id', () => {
  it('hides the definition from the list, keeps the read-one, and blocks a new run', async () => {
    const fake = db();
    const jobQueue = queue();
    const app = createServer(fake.asPool(), jobQueue, storage);

    expect((await request(app).get('/definitions')).body.items).toHaveLength(1);
    expect((await request(app).delete('/definitions/def-1')).status).toBe(204);

    expect((await request(app).get('/definitions')).body.items).toEqual([]);
    expect((await request(app).get('/definitions/def-1')).status).toBe(200);

    const run = await request(app).post('/runs').send({ definitionId: 'def-1' });
    expect(run.status).toBe(409);
    expect(jobQueue.add).not.toHaveBeenCalled();
  });

  it('returns 404 on a second delete', async () => {
    const app = createServer(db().asPool(), queue(), storage);

    expect((await request(app).delete('/definitions/def-1')).status).toBe(204);
    expect((await request(app).delete('/definitions/def-1')).status).toBe(404);
  });
});

describe('DELETE /schedules/:id', () => {
  it.each([
    { desc: 'an existing schedule', rowCount: 1, status: 204 },
    { desc: 'an unknown schedule', rowCount: 0, status: 404 },
  ])('answers $status for $desc', async ({ rowCount, status }) => {
    const pool = {
      async query() {
        return { rows: [], command: '', rowCount, oid: 0, fields: [] };
      },
    } as never;
    const app = createServer(pool, queue(), storage);

    const res = await request(app).delete('/schedules/sched-1');

    expect(res.status).toBe(status);
  });
});
