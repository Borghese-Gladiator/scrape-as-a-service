import type { Job } from 'bullmq';
import type { Browser } from 'playwright';
import {
  finishAttempt,
  getDefinition,
  insertArtifact,
  insertAttempt,
  updateRunStatus,
  type Queryable,
} from '@scraper/db';
import { validateScrapeConfig, type ScrapeJobData, type StorageClient } from '@scraper/shared';
import { buildAndUploadArtifacts } from './artifacts.js';
import { runScrape } from './scrape.js';

export interface ProcessRunDeps {
  pool: Queryable;
  storage: StorageClient;
  workerId: string;
  launchBrowser: () => Promise<Browser>;
}

function errorCode(err: unknown): string {
  if (err instanceof Error && err.name) return err.name;
  return 'SCRAPE_ERROR';
}

/**
 * Record the error on the current attempt and, only when BullMQ has exhausted
 * all retries for this job, mark the run FAILED. Always rethrows so BullMQ
 * schedules the next retry (which becomes a NEW attempt).
 */
export async function finalizeFailure(
  pool: Queryable,
  job: Job<ScrapeJobData>,
  attemptId: string,
  err: Error,
): Promise<never> {
  await finishAttempt(pool, attemptId, 'FAILED', {
    code: errorCode(err),
    message: err.message,
  });

  const maxAttempts = job.opts.attempts ?? 1;
  const isLastAttempt = job.attemptsMade + 1 >= maxAttempts;
  if (isLastAttempt) {
    await updateRunStatus(pool, job.data.runId, 'FAILED', new Date());
  }

  throw err;
}

/**
 * Per-job lifecycle: create a new attempt (incrementing attempt_number), mark
 * the run RUNNING, run the declarative scrape in an isolated browser, upload
 * artifacts, persist their metadata, and mark attempt + run SUCCEEDED. On error
 * the attempt is failed and the error rethrown so BullMQ retries.
 */
export async function processRun(
  job: Job<ScrapeJobData>,
  deps: ProcessRunDeps,
): Promise<void> {
  const { pool, storage, workerId, launchBrowser } = deps;
  const { runId, definitionId } = job.data;

  const attempt = await insertAttempt(pool, runId, workerId);
  await updateRunStatus(pool, runId, 'RUNNING', new Date());

  let browser: Browser | undefined;
  try {
    const definition = await getDefinition(pool, definitionId);
    if (!definition) {
      throw new Error(`definition not found: ${definitionId}`);
    }

    // A definition stored before Phase 2 still holds a v1 config; upgrade it.
    const config = validateScrapeConfig(definition.config);

    browser = await launchBrowser();
    const result = await runScrape(browser, definition.url, config);
    await browser.close();
    browser = undefined;

    const uploaded = await buildAndUploadArtifacts(storage, runId, config, result);
    for (const { type, put, name, stepIndex } of uploaded) {
      await insertArtifact(pool, runId, type, put, name, stepIndex);
    }

    await finishAttempt(pool, attempt.id, 'SUCCEEDED');
    await updateRunStatus(pool, runId, 'SUCCEEDED', new Date());
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    return finalizeFailure(pool, job, attempt.id, err as Error);
  }
}
