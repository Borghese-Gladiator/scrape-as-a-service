import { beforeEach, expect, it } from 'vitest';
import { describeIntegration, useTestDb } from '../../../../test/integration/harness.js';
import { createDefinition } from '../repositories/definitions.js';
import { createRun } from '../repositories/runs.js';
import { finishAttempt, insertAttempt, listAttempts } from '../repositories/attempts.js';
import type { ScrapeConfig } from '../types.js';

const CONFIG: ScrapeConfig = {
  steps: [{ op: 'extract', name: 'rows', fields: [{ name: 'title', selector: 'h1' }] }],
};

describeIntegration('attempts repository', () => {
  const { pool } = useTestDb();
  let runId = '';

  beforeEach(async () => {
    const definition = await createDefinition(pool, {
      name: 'attempts',
      url: 'https://example.com',
      config: CONFIG,
    });
    const run = await createRun(pool, definition.id, 'MANUAL');
    runId = run.id;
  });

  it('increments attempt_number per run', async () => {
    const first = await insertAttempt(pool, runId, 'worker-1');
    const second = await insertAttempt(pool, runId, 'worker-2');
    const third = await insertAttempt(pool, runId, 'worker-1');

    expect([first, second, third].map((a) => a.attempt_number)).toEqual([1, 2, 3]);
    expect(first.status).toBe('RUNNING');
    expect(first.worker_id).toBe('worker-1');
    expect(first.error_code).toBeNull();
    expect(first.finished_at).toBeNull();
  });

  it('numbers attempts independently for each run', async () => {
    const definition = await createDefinition(pool, {
      name: 'other',
      url: 'https://other.example',
      config: CONFIG,
    });
    const otherRun = await createRun(pool, definition.id, 'MANUAL');

    await insertAttempt(pool, runId, 'worker-1');
    const otherFirst = await insertAttempt(pool, otherRun.id, 'worker-1');
    expect(otherFirst.attempt_number).toBe(1);
  });

  it('finishes an attempt as SUCCEEDED with no error', async () => {
    const attempt = await insertAttempt(pool, runId, 'worker-1');
    const finished = await finishAttempt(pool, attempt.id, 'SUCCEEDED');

    expect(finished.status).toBe('SUCCEEDED');
    expect(finished.error_code).toBeNull();
    expect(finished.error_message).toBeNull();
    expect(finished.finished_at).toBeInstanceOf(Date);
  });

  it('finishes an attempt as FAILED and records the error', async () => {
    const attempt = await insertAttempt(pool, runId, 'worker-1');
    const finished = await finishAttempt(pool, attempt.id, 'FAILED', {
      code: 'TimeoutError',
      message: 'page.goto timed out',
    });

    expect(finished.status).toBe('FAILED');
    expect(finished.error_code).toBe('TimeoutError');
    expect(finished.error_message).toBe('page.goto timed out');
  });

  it('lists attempts in ascending attempt_number order', async () => {
    const first = await insertAttempt(pool, runId, 'worker-1');
    const second = await insertAttempt(pool, runId, 'worker-1');

    const attempts = await listAttempts(pool, runId);
    expect(attempts.map((a) => a.id)).toEqual([first.id, second.id]);
  });
});
