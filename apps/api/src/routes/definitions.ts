import { Router } from 'express';
import type { Pool } from 'pg';
import { createDefinition, listDefinitions } from '@scraper/db';
import { assertSafeUrl, validateScrapeConfig } from '@scraper/shared';
import { asyncHandler, HttpError } from '../http.js';

export type AssertUrl = (url: string) => Promise<void>;

export function definitionsRouter(pool: Pool, assertUrl: AssertUrl = assertSafeUrl): Router {
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
      try {
        await assertUrl(url);
      } catch (err) {
        throw new HttpError(400, (err as Error).message);
      }
      let config;
      try {
        config = validateScrapeConfig(body?.config);
      } catch (err) {
        throw new HttpError(400, (err as Error).message);
      }
      const definition = await createDefinition(pool, { name, url, config });
      if (!definition) {
        throw new HttpError(500, 'failed to create the definition');
      }
      res.status(201).json(definition);
    }),
  );

  return router;
}
