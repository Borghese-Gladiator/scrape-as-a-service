import { Router } from 'express';
import type { Pool } from 'pg';
import { deleteSecret, listSecrets, upsertSecret } from '@scraper/db';
import { encryptSecret } from '@scraper/shared';
import { asyncHandler, HttpError, parseBody } from '../http.js';
import { CreateSecretBody } from '../schemas.js';

/**
 * The store is write-and-forget from the API side. A value goes in encrypted
 * and never comes back out: only the worker holds a path to `decryptSecret`.
 */
export function secretsRouter(pool: Pool): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json(await listSecrets(pool));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = parseBody(CreateSecretBody, req.body);

      let ciphertext: string;
      try {
        ciphertext = encryptSecret(body.value);
      } catch (err) {
        throw new HttpError(500, (err as Error).message);
      }
      res.status(201).json(await upsertSecret(pool, body.name, ciphertext));
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const removed = await deleteSecret(pool, req.params.id ?? '');
      if (!removed) {
        throw new HttpError(404, 'secret not found');
      }
      res.status(204).end();
    }),
  );

  return router;
}
