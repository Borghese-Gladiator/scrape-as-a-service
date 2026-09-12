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
import {
  createLogger,
  type Logger,
  type ScrapeJobData,
  type StorageClient,
} from '@scraper/shared';
import { buildAndUploadArtifacts, uploadFailureDiagnostics } from './artifacts.js';
import { getDiagnostics } from './diagnostics.js';
import { runScrape } from './scrape.js';

export interface ProcessRunDeps {
  pool: Queryable;
  storage: StorageClient;
  workerId: string;
  launchBrowser: () => Promise<Browser>;
  logger?: Logger;
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
  const logger = (deps.logger ?? createLogger('worker')).child({
    runId,
    definitionId,
    attemptId: attempt.id,
  });
  await updateRunStatus(pool, runId, 'RUNNING', new Date());
  logger.info({ attemptNumber: attempt.attempt_number }, 'run started');

  let browser: Browser | undefined;
  try {
    const definition = await getDefinition(pool, definitionId);
    if (!definition) {
      throw new Error(`definition not found: ${definitionId}`);
    }

    browser = await launchBrowser();
    const result = await runScrape(browser, definition.url, definition.config);
    await browser.close();
    browser = undefined;

    const uploaded = await buildAndUploadArtifacts(
      storage,
      runId,
      definition.config,
      result,
    );
    for (const { type, put } of uploaded) {
      await insertArtifact(pool, runId, type, put);
    }

    await finishAttempt(pool, attempt.id, 'SUCCEEDED');
    await updateRunStatus(pool, runId, 'SUCCEEDED', new Date());
    logger.info({ artifacts: uploaded.length, rows: result.rows.length }, 'run succeeded');
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    await storeDiagnostics(pool, storage, runId, err, logger);
    logger.error({ err }, 'run attempt failed');
    return finalizeFailure(pool, job, attempt.id, err as Error);
  }
}

/**
 * Store whatever the failing scrape captured. This runs before finalizeFailure
 * so the artifacts exist by the time the run reaches FAILED. It never throws:
 * a diagnostics upload must not replace the error that caused the failure.
 */
async function storeDiagnostics(
  pool: Queryable,
  storage: StorageClient,
  runId: string,
  err: unknown,
  logger: Logger,
): Promise<void> {
  const diagnostics = getDiagnostics(err);
  if (!diagnostics) return;

  try {
    const uploaded = await uploadFailureDiagnostics(storage, runId, diagnostics);
    for (const { type, put } of uploaded) {
      await insertArtifact(pool, runId, type, put);
    }
    logger.info({ artifacts: uploaded.length }, 'stored failure diagnostics');
  } catch (diagnosticErr) {
    logger.warn({ err: diagnosticErr }, 'could not store failure diagnostics');
  }
}
