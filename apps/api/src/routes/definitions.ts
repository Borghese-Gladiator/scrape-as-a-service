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
import { assertSafeUrl, validateScrapeConfig } from '@scraper/shared';
import { asyncHandler, HttpError, parseBody } from '../http.js';
import { pageQuery } from '../query.js';
import { CreateDefinitionBody, UpdateDefinitionBody } from '../schemas.js';

function parseConfig(input: unknown) {
  try {
    return validateScrapeConfig(input);
  } catch (err) {
    throw new HttpError(400, (err as Error).message);
  }
}

export type AssertUrl = (url: string) => Promise<void>;

export function definitionsRouter(
  pool: Pool,
  assertUrl: AssertUrl = assertSafeUrl,
): Router {
  const router = Router();

  async function checkUrl(url: string): Promise<void> {
    try {
      await assertUrl(url);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  }

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
      const body = parseBody(CreateDefinitionBody, req.body);
      await checkUrl(body.url);
      const config = parseConfig(body.config);
      const definition = await createDefinition(pool, {
        name: body.name,
        url: body.url,
        config,
      });
      if (!definition) {
        throw new HttpError(500, 'failed to create the definition');
      }
      res.status(201).json(definition);
    }),
  );

  router.put(
    '/:id',
    asyncHandler(async (req, res) => {
      const body = parseBody(UpdateDefinitionBody, req.body);
      const input: UpdateDefinitionInput = {};

      if (body.name !== undefined) input.name = body.name;
      if (body.url !== undefined) {
        await checkUrl(body.url);
        input.url = body.url;
      }
      if (body.config !== undefined) input.config = parseConfig(body.config);

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
      const definition = await softDeleteDefinition(
        pool,
        req.params.id ?? '',
        new Date(),
      );
      if (!definition) {
        throw new HttpError(404, 'definition not found');
      }
      res.status(204).end();
    }),
  );

  return router;
}
