import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Queue, Worker } from 'bullmq';
import { chromium } from 'playwright';
import { Pool } from 'pg';
import {
  getRedisConnection,
  getStorage,
  type ScrapeJobData,
  type StorageClient,
} from '@scraper/shared';
import {
  describeIntegration,
  truncateAll,
} from '../../../../test/integration/harness.js';
import { testConfig } from '../../../../test/integration/config.js';
import { processRun } from '../../../worker/src/process-run.js';
import { createServer } from '../server.js';

const FIXTURE_HTML = `<!doctype html>
<html>
  <head><title>Receipts</title></head>
  <body>
    <table id="rows">
      <tr class="row"><td class="date">2026-01-02</td><td class="amount">12.50</td></tr>
      <tr class="row"><td class="date">2026-01-09</td><td class="amount">18.00</td></tr>
      <tr class="row"><td class="date">2026-01-16</td><td class="amount">7.25</td></tr>
    </table>
  </body>
</html>`;

const BROWSER_ORIGIN = 'http://localhost:3000';
const QUEUE_NAME = `scrape-e2e-${randomUUID()}`;

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function pollRun(apiBase: string, runId: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 90_000;
  let last: Record<string, unknown> = {};
  while (Date.now() < deadline) {
    const response = await fetch(`${apiBase}/runs/${runId}`);
    expect(response.status).toBe(200);
    last = (await response.json()) as Record<string, unknown>;
    if (last.status === 'SUCCEEDED' || last.status === 'FAILED') return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `run ${runId} never reached a terminal status: ${JSON.stringify(last)}`,
  );
}

describeIntegration('end to end: definition to artifact download', () => {
  const config = testConfig();
  let pool: Pool;
  let storage: StorageClient;
  let queue: Queue<ScrapeJobData>;
  let worker: Worker<ScrapeJobData>;
  let fixture: Server;
  let api: Server;
  let fixtureUrl = '';
  let apiBase = '';

  beforeAll(async () => {
    pool = new Pool({ connectionString: config.databaseUrl });
    await truncateAll(pool);

    storage = getStorage(config);
    await storage.ensureBucket();

    queue = new Queue<ScrapeJobData>(QUEUE_NAME, {
      connection: getRedisConnection(config),
      defaultJobOptions: { attempts: 1, removeOnComplete: false, removeOnFail: false },
    });

    worker = new Worker<ScrapeJobData>(
      QUEUE_NAME,
      async (job) => {
        await processRun(job, {
          pool,
          storage,
          workerId: 'e2e-worker',
          launchBrowser: () => chromium.launch(),
        });
      },
      { connection: getRedisConnection(config), concurrency: 1 },
    );
    await worker.waitUntilReady();

    fixture = createHttpServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(FIXTURE_HTML);
    });
    fixtureUrl = `http://127.0.0.1:${await listen(fixture)}/`;

    api = createHttpServer(createServer(pool, queue, storage));
    apiBase = `http://127.0.0.1:${await listen(api)}`;
  });

  afterAll(async () => {
    await worker?.close();
    await queue?.obliterate({ force: true }).catch(() => {});
    await queue?.close();
    if (api) await close(api);
    if (fixture) await close(fixture);
    await pool?.end();
  });

  it('answers a cross-origin preflight for POST /definitions', async () => {
    const response = await fetch(`${apiBase}/definitions`, {
      method: 'OPTIONS',
      headers: {
        Origin: BROWSER_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });

    expect(response.status).toBeLessThan(300);
    expect(response.headers.get('access-control-allow-origin')).toBeTruthy();
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('creates a definition, runs it, and downloads every artifact', async () => {
    const createResponse = await fetch(`${apiBase}/definitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BROWSER_ORIGIN },
      body: JSON.stringify({
        name: 'e2e fixture',
        url: fixtureUrl,
        config: {
          waitFor: '#rows',
          rowSelector: 'tr.row',
          fields: [
            { name: 'date', selector: 'td.date' },
            { name: 'amount', selector: 'td.amount' },
          ],
          artifacts: ['JSON', 'CSV', 'PNG'],
        },
      }),
    });

    expect(createResponse.status).toBe(201);
    expect(createResponse.headers.get('access-control-allow-origin')).toBeTruthy();
    const definition = (await createResponse.json()) as { id: string };

    const runResponse = await fetch(`${apiBase}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BROWSER_ORIGIN },
      body: JSON.stringify({ definitionId: definition.id }),
    });
    expect(runResponse.status).toBe(201);
    const run = (await runResponse.json()) as { id: string; status: string };
    expect(run.status).toBe('QUEUED');

    const finished = await pollRun(apiBase, run.id);
    expect(finished.status, `attempts: ${JSON.stringify(finished.attempts)}`).toBe(
      'SUCCEEDED',
    );

    const artifactsResponse = await fetch(`${apiBase}/runs/${run.id}/artifacts`);
    expect(artifactsResponse.status).toBe(200);
    const artifacts = (await artifactsResponse.json()) as Array<{
      id: string;
      type: string;
      object_key: string;
    }>;
    expect(artifacts.map((a) => a.type).sort()).toEqual(['CSV', 'JSON', 'PNG']);

    const json = artifacts.find((a) => a.type === 'JSON');
    const download = await fetch(`${apiBase}/artifacts/${json?.id}/download`);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toContain('application/json');
    expect(download.headers.get('content-disposition')).toContain('data.json');

    const rows = JSON.parse(await download.text()) as Array<Record<string, string>>;
    expect(rows).toEqual([
      { date: '2026-01-02', amount: '12.50' },
      { date: '2026-01-09', amount: '18.00' },
      { date: '2026-01-16', amount: '7.25' },
    ]);

    const png = artifacts.find((a) => a.type === 'PNG');
    const image = await fetch(`${apiBase}/artifacts/${png?.id}/download`);
    expect(image.status).toBe(200);
    const bytes = Buffer.from(await image.arrayBuffer());
    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  it('returns 404 for an unknown artifact', async () => {
    const response = await fetch(
      `${apiBase}/artifacts/00000000-0000-0000-0000-000000000000/download`,
    );
    expect(response.status).toBe(404);
  });
});
