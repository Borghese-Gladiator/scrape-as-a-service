import { Router } from 'express';
import type { Pool } from 'pg';
import {
  createDefinition,
  getDefinition,
  listDefinitions,
  softDeleteDefinition,
  updateDefinition,
  type UpdateDefinitionInput,
} from '@scraper/db';
import { validateScrapeConfig } from '@scraper/shared';
import { asyncHandler, HttpError } from '../http.js';
import { pageQuery } from '../query.js';

function parseConfig(input: unknown) {
  try {
    return validateScrapeConfig(input);
  } catch (err) {
    throw new HttpError(400, (err as Error).message);
  }
}

export function definitionsRouter(pool: Pool): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.json(await listDefinitions(pool, pageQuery(req)));
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const definition = await getDefinition(pool, req.params.id ?? '');
      if (!definition) {
        throw new HttpError(404, 'definition not found');
      }
      res.json(definition);
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
      const config = parseConfig(body?.config);
      const definition = await createDefinition(pool, { name, url, config });
      res.status(201).json(definition);
    }),
  );

  router.put(
    '/:id',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const input: UpdateDefinitionInput = {};

      if (body.name !== undefined) {
        if (typeof body.name !== 'string' || body.name.length === 0) {
          throw new HttpError(400, 'name must be a non-empty string');
        }
        input.name = body.name;
      }
      if (body.url !== undefined) {
        if (typeof body.url !== 'string' || body.url.length === 0) {
          throw new HttpError(400, 'url must be a non-empty string');
        }
        input.url = body.url;
      }
      if (body.config !== undefined) {
        input.config = parseConfig(body.config);
      }
      if (Object.keys(input).length === 0) {
        throw new HttpError(400, 'one of name, url and config is required');
      }

      const definition = await updateDefinition(pool, req.params.id ?? '', input);
      if (!definition) {
        throw new HttpError(404, 'definition not found');
      }
      res.json(definition);
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const definition = await softDeleteDefinition(pool, req.params.id ?? '', new Date());
      if (!definition) {
        throw new HttpError(404, 'definition not found');
      }
      res.status(204).end();
    }),
  );

  return router;
}
