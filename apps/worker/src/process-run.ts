import type { Job } from 'bullmq';
import type { Browser } from 'playwright';
import {
  finishAttempt,
  getDefinition,
  insertArtifact,
  insertAttempt,
  touchAttempt,
  updateRunStatus,
  upsertSecret,
  type Queryable,
} from '@scraper/db';
import {
  createLogger,
  ScrapeError,
  toErrorCode,
  validateScrapeConfig,
  collectSecretRefs,
  encryptSecret,
  type Logger,
  type ScrapeJobData,
  type StorageClient,
} from '@scraper/shared';
import { buildAndUploadArtifacts, uploadFailureDiagnostics } from './artifacts.js';
import { getDiagnostics } from './diagnostics.js';
import type { ScrapeResult } from './interpreter.js';
import { closeScrapeSession, openScrapeSession, runScrape } from './scrape.js';
import { loadSecrets } from './secrets.js';

export const HEARTBEAT_INTERVAL_MS = 15_000;

export interface ProcessRunDeps {
  pool: Queryable;
  storage: StorageClient;
  workerId: string;
  getBrowser: () => Promise<Browser>;
  runTimeoutMs: number;
  logger?: Logger;
  allowCdp?: boolean;
  allowLocalProfile?: boolean;
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
    code: toErrorCode(err),
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
 * Bound the scrape. The timer runs inside the processor, so BullMQ keeps
 * renewing the job lock and never treats the job as stalled; the rejection is
 * an ordinary job failure that BullMQ retries.
 */
async function withRunTimeout(
  work: Promise<ScrapeResult>,
  timeoutMs: number,
): Promise<ScrapeResult> {
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new ScrapeError('TIMEOUT', `run exceeded ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([work, expiry]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Per-job lifecycle: create a new attempt (incrementing attempt_number), mark
 * the run RUNNING, run the declarative scrape in an isolated context of the
 * shared browser, upload artifacts, persist their metadata, and mark attempt +
 * run SUCCEEDED. On error the attempt is failed and the error rethrown so
 * BullMQ retries. A heartbeat runs for the whole life of the job, so that the
 * scheduler sweeper can tell a live job from an abandoned one.
 */
export async function processRun(
  job: Job<ScrapeJobData>,
  deps: ProcessRunDeps,
): Promise<void> {
  const { pool, storage, workerId, getBrowser, runTimeoutMs } = deps;
  const { runId, definitionId } = job.data;

  const attempt = await insertAttempt(pool, runId, workerId);
  if (!attempt) {
    throw new Error(`failed to create an attempt for run: ${runId}`);
  }
  const logger = (deps.logger ?? createLogger('worker')).child({
    runId,
    definitionId,
    attemptId: attempt.id,
  });
  const running = await updateRunStatus(pool, runId, 'RUNNING', new Date());
  if (!running) {
    throw new Error(`run not found: ${runId}`);
  }
  logger.info({ attemptNumber: attempt.attempt_number }, 'run started');

  const heartbeat = setInterval(() => {
    void touchAttempt(pool, attempt.id).catch(() => {});
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  try {
    try {
      const definition = await getDefinition(pool, definitionId);
      if (!definition) {
        throw new Error(`definition not found: ${definitionId}`);
      }
      // A definition stored before Phase 2 still holds a v1 config; upgrade it.
      const config = validateScrapeConfig(definition.config);
      // Secrets are resolved here and nowhere else: only the worker decrypts.
      const secrets = await loadSecrets(pool, collectSecretRefs(config));

      const browser = await getBrowser();
      const session = await openScrapeSession(browser, definition.url, config, {
        secrets,
        allowCdp: deps.allowCdp ?? false,
        allowLocalProfile: deps.allowLocalProfile ?? false,
        saveSecret: async (name, value) => {
          await upsertSecret(pool, name, encryptSecret(value));
        },
      });
      let result: ScrapeResult;
      try {
        result = await withRunTimeout(
          runScrape(session, definition.url, config, { secrets }),
          runTimeoutMs,
        );
      } finally {
        await closeScrapeSession(session);
      }

      const uploaded = await buildAndUploadArtifacts(storage, runId, config, result);
      for (const { type, put, name, stepIndex } of uploaded) {
        await insertArtifact(pool, runId, type, put, name, stepIndex);
      }

      await finishAttempt(pool, attempt.id, 'SUCCEEDED');
      await updateRunStatus(pool, runId, 'SUCCEEDED', new Date());
      logger.info(
        { artifacts: uploaded.length, datasets: Object.keys(result.datasets).length },
        'run succeeded',
      );
    } catch (err) {
      await storeDiagnostics(pool, storage, runId, err, logger);
      logger.error({ err }, 'run attempt failed');
      return await finalizeFailure(pool, job, attempt.id, err as Error);
    }
  } finally {
    clearInterval(heartbeat);
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
    for (const { type, put, name, stepIndex } of uploaded) {
      await insertArtifact(pool, runId, type, put, name, stepIndex);
    }
    logger.info({ artifacts: uploaded.length }, 'stored failure diagnostics');
  } catch (diagnosticErr) {
    logger.warn({ err: diagnosticErr }, 'could not store failure diagnostics');
  }
}
