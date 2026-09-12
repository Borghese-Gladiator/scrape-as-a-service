import { Router } from 'express';
import type { Pool } from 'pg';
import { getArtifact, listArtifacts } from '@scraper/db';
import type { StorageClient } from '@scraper/shared';
import { asyncHandler, HttpError } from '../http.js';

export function artifactsRouter(pool: Pool, storage: StorageClient): Router {
  const router = Router();

  router.get(
    '/runs/:runId/artifacts',
    asyncHandler(async (req, res) => {
      res.json(await listArtifacts(pool, req.params.runId ?? ''));
    }),
  );

  router.get(
    '/artifacts/:id/download',
    asyncHandler(async (req, res) => {
      const artifact = await getArtifact(pool, req.params.id ?? '');
      if (!artifact) {
        throw new HttpError(404, 'artifact not found');
      }
      const stream = await storage.getStream(artifact.object_key);
      res.setHeader('Content-Type', artifact.content_type);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${artifact.object_key.split('/').pop() ?? 'artifact'}"`,
      );
      stream.on('error', (err: Error) => {
        res.destroy(err);
      });
      stream.pipe(res);
    }),
  );

  return router;
}
