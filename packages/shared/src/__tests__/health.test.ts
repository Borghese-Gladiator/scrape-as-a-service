import { describe, it, expect, afterEach } from 'vitest';
import { startHealthServer, type HealthServer } from '../health.js';

let server: HealthServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('startHealthServer', () => {
  it('answers GET /health with the status, the uptime and the extra details', async () => {
    server = await startHealthServer({ port: 0, details: () => ({ activeJobs: 2 }) });

    const res = await fetch(`http://127.0.0.1:${server.port}/health`);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.activeJobs).toBe(2);
    expect(typeof body.uptimeSeconds).toBe('number');
  });

  it('answers 404 on any other path', async () => {
    server = await startHealthServer({ port: 0 });

    const res = await fetch(`http://127.0.0.1:${server.port}/runs`);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not found' });
  });
});
