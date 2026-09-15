import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { Queue } from 'bullmq';
import { describeIntegration } from '../../../../test/integration/harness.js';
import { testConfig } from '../../../../test/integration/config.js';
import {
  defaultJobOptions,
  enqueueRun,
  getRedisConnection,
  SCRAPE_QUEUE_NAME,
  type ScrapeJobData,
} from '../queue.js';

describeIntegration('BullMQ queue', () => {
  const config = testConfig();
  const queue = new Queue<ScrapeJobData>(`${SCRAPE_QUEUE_NAME}-itest`, {
    connection: getRedisConnection(config),
    defaultJobOptions: defaultJobOptions(),
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it('enqueues a job and reads it back with the default options applied', async () => {
    const data: ScrapeJobData = { runId: randomUUID(), definitionId: randomUUID() };
    await enqueueRun(queue, data);

    const job = await queue.getJob(data.runId);
    expect(job?.name).toBe('scrape-run');
    expect(job?.data).toEqual(data);
    expect(job?.opts.attempts).toBe(3);
    expect(job?.opts.backoff).toEqual({ type: 'exponential', delay: 5000 });
  });

  it('deduplicates on the run id, so one run enqueues one job', async () => {
    const data: ScrapeJobData = { runId: randomUUID(), definitionId: randomUUID() };
    await enqueueRun(queue, data);
    await enqueueRun(queue, data);

    const waiting = await queue.getWaiting();
    expect(waiting.filter((job) => job.id === data.runId)).toHaveLength(1);
  });
});
