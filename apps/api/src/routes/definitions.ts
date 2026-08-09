import { Router } from 'express';
import type { Pool } from 'pg';
import { createDefinition, listDefinitions } from '@scraper/db';
import { validateScrapeConfig } from '@scraper/shared';
import { asyncHandler, HttpError } from '../http.js';

export function definitionsRouter(pool: Pool): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json(await listDefinitions(pool));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const name = body?.name;
      const url = body?.url;
      if (typeof name !== 'string' || name.length === 0) {
        throw new HttpError(400, 'name is required');
      }
      if (typeof url !== 'string' || url.length === 0) {
        throw new HttpError(400, 'url is required');
      }
      let config;
      try {
        config = validateScrapeConfig(body?.config);
      } catch (err) {
        throw new HttpError(400, (err as Error).message);
      }
      const definition = await createDefinition(pool, { name, url, config });
      res.status(201).json(definition);
    }),
  );

  return router;
}
