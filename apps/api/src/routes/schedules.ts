import { Router } from 'express';
import type { Pool } from 'pg';
import {
  CATCH_UP_POLICIES,
  createSchedule,
  deleteSchedule,
  getDefinition,
  isCatchUpPolicy,
  listSchedules,
  setScheduleEnabled,
} from '@scraper/db';
import { computeNextRun } from '@scraper/shared';
import { asyncHandler, HttpError } from '../http.js';

export function schedulesRouter(pool: Pool): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const definitionId =
        typeof req.query.definitionId === 'string' ? req.query.definitionId : undefined;
      res.json(await listSchedules(pool, definitionId));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const definitionId = body?.definitionId;
      const cron = body?.cron;
      const timezone = body?.timezone;
      if (typeof definitionId !== 'string' || definitionId.length === 0) {
        throw new HttpError(400, 'definitionId is required');
      }
      if (typeof cron !== 'string' || cron.length === 0) {
        throw new HttpError(400, 'cron is required');
      }
      if (typeof timezone !== 'string' || timezone.length === 0) {
        throw new HttpError(400, 'timezone is required');
      }
      const enabled = body?.enabled === undefined ? true : Boolean(body.enabled);
      const catchUp = body?.catchUp ?? 'skip';
      if (!isCatchUpPolicy(catchUp)) {
        throw new HttpError(400, `catchUp must be one of: ${CATCH_UP_POLICIES.join(', ')}`);
      }

      const definition = await getDefinition(pool, definitionId);
      if (!definition) {
        throw new HttpError(404, 'definition not found');
      }

      let nextRunAt: Date;
      try {
        nextRunAt = computeNextRun(cron, timezone, new Date());
      } catch (err) {
        throw new HttpError(400, `invalid cron/timezone: ${(err as Error).message}`);
      }

      const schedule = await createSchedule(
        pool,
        { definitionId, cron, timezone, enabled, catchUp },
        nextRunAt,
      );
      if (!schedule) {
        throw new HttpError(500, 'failed to create the schedule');
      }
      res.status(201).json(schedule);
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const enabled = (req.body as Record<string, unknown>)?.enabled;
      if (typeof enabled !== 'boolean') {
        throw new HttpError(400, 'enabled (boolean) is required');
      }
      const schedule = await setScheduleEnabled(pool, req.params.id ?? '', enabled);
      if (!schedule) {
        throw new HttpError(404, 'schedule not found');
      }
      res.json(schedule);
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const removed = await deleteSchedule(pool, req.params.id ?? '');
      if (!removed) {
        throw new HttpError(404, 'schedule not found');
      }
      res.status(204).end();
    }),
  );

  return router;
}
