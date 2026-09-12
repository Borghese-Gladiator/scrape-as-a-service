import { Router } from 'express';
import type { Pool } from 'pg';
import type { Queue } from 'bullmq';
import {
  createRun,
  failRunningAttempts,
  finishAttempt,
  getDefinition,
  getRun,
  getRunDetail,
  insertAttempt,
  listRuns,
  updateRunStatus,
  type ListRunsQuery,
} from '@scraper/db';
import { enqueueRun, type ScrapeJobData } from '@scraper/shared';
import type { RunTrigger } from '@scraper/db';
import { asyncHandler, HttpError } from '../http.js';
import { pageQuery, queryString, runStatus } from '../query.js';

/**
 * A cancel reuses FAILED and records the reason as an error code, so the run
 * status enum keeps its four values. See docs/plans/phase-5-delivery.md.
 */
const CANCEL_CODE = 'CANCELLED';
const CANCEL_MESSAGE = 'the run was cancelled through the API';

async function trigger(
  pool: Pool,
  queue: Queue<ScrapeJobData>,
  definitionId: string,
  source: RunTrigger,
) {
  const definition = await getDefinition(pool, definitionId);
  if (!definition) {
    throw new HttpError(404, 'definition not found');
  }
  if (definition.deleted_at) {
    throw new HttpError(409, 'definition is deleted');
  }
  const run = await createRun(pool, definitionId, source);
  await enqueueRun(queue, { runId: run.id, definitionId });
  return run;
}

export function runsRouter(pool: Pool, queue: Queue<ScrapeJobData>): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const query: ListRunsQuery = pageQuery(req);
      const definitionId = queryString(req, 'definitionId');
      const status = runStatus(req);
      if (definitionId !== undefined) query.definitionId = definitionId;
      if (status !== undefined) query.status = status;
      res.json(await listRuns(pool, query));
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const detail = await getRunDetail(pool, req.params.id ?? '');
      if (!detail) {
        throw new HttpError(404, 'run not found');
      }
      res.json(detail);
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const definitionId = (req.body as Record<string, unknown>)?.definitionId;
      if (typeof definitionId !== 'string' || definitionId.length === 0) {
        throw new HttpError(400, 'definitionId is required');
      }
      const run = await trigger(pool, queue, definitionId, 'MANUAL');
      res.status(201).json(run);
    }),
  );

  router.post(
    '/api-trigger',
    asyncHandler(async (req, res) => {
      const definitionId = (req.body as Record<string, unknown>)?.definitionId;
      if (typeof definitionId !== 'string' || definitionId.length === 0) {
        throw new HttpError(400, 'definitionId is required');
      }
      const run = await trigger(pool, queue, definitionId, 'API');
      res.status(201).json(run);
    }),
  );

  /**
   * A QUEUED run loses its BullMQ job and gains a FAILED attempt that carries
   * the reason. A RUNNING run keeps its worker: the job is already locked, so
   * the cancel marks the records and the worker finds them on its next write.
   */
  router.post(
    '/:id/cancel',
    asyncHandler(async (req, res) => {
      const runId = req.params.id ?? '';
      const run = await getRun(pool, runId);
      if (!run) {
        throw new HttpError(404, 'run not found');
      }
      if (run.status === 'SUCCEEDED' || run.status === 'FAILED') {
        throw new HttpError(409, `run is already ${run.status}`);
      }

      await queue.remove(runId).catch(() => 0);

      const failed = await failRunningAttempts(pool, runId, {
        code: CANCEL_CODE,
        message: CANCEL_MESSAGE,
      });
      if (failed.length === 0) {
        const attempt = await insertAttempt(pool, runId, 'api-cancel');
        await finishAttempt(pool, attempt.id, 'FAILED', {
          code: CANCEL_CODE,
          message: CANCEL_MESSAGE,
        });
      }

      const cancelled = await updateRunStatus(pool, runId, 'FAILED', new Date());
      res.json(cancelled);
    }),
  );

  router.post(
    '/:id/rerun',
    asyncHandler(async (req, res) => {
      const run = await getRun(pool, req.params.id ?? '');
      if (!run) {
        throw new HttpError(404, 'run not found');
      }
      const rerun = await trigger(pool, queue, run.definition_id, 'MANUAL');
      res.status(201).json(rerun);
    }),
  );

  return router;
}
