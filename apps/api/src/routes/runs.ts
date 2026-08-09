import { Router } from 'express';
import type { Pool } from 'pg';
import type { Queue } from 'bullmq';
import {
  createRun,
  getDefinition,
  getRunDetail,
  listRuns,
} from '@scraper/db';
import { enqueueRun, type ScrapeJobData } from '@scraper/shared';
import type { RunTrigger } from '@scraper/db';
import { asyncHandler, HttpError } from '../http.js';

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
  const run = await createRun(pool, definitionId, source);
  await enqueueRun(queue, { runId: run.id, definitionId });
  return run;
}

export function runsRouter(pool: Pool, queue: Queue<ScrapeJobData>): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const definitionId =
        typeof req.query.definitionId === 'string' ? req.query.definitionId : undefined;
      res.json(await listRuns(pool, definitionId));
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

  return router;
}
