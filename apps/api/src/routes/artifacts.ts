import { Router } from 'express';
import type { Pool } from 'pg';
import { getArtifact, listArtifacts } from '@scraper/db';
import type { StorageClient } from '@scraper/shared';
import { asyncHandler, HttpError } from '../http.js';

/**
 * Short enough that a leaked link expires quickly, long enough for a person to
 * open a run page and click through its artifacts.
 */
const PRESIGN_SECONDS = 900;

export function artifactsRouter(pool: Pool, storage: StorageClient): Router {
  const router = Router();

  router.get(
    '/runs/:runId/artifacts',
    asyncHandler(async (req, res) => {
      res.json(await listArtifacts(pool, req.params.runId ?? ''));
    }),
  );

  /**
   * The browser cannot put `X-API-Key` on an `<a href>`, so a page that renders
   * a download link asks for a presigned URL here instead.
   */
  router.get(
    '/artifacts/:id/url',
    asyncHandler(async (req, res) => {
      const artifact = await getArtifact(pool, req.params.id ?? '');
      if (!artifact) {
        throw new HttpError(404, 'artifact not found');
      }
      const url = await storage.presignedGetUrl(artifact.object_key, PRESIGN_SECONDS);
      res.json({ url, expiresInSeconds: PRESIGN_SECONDS });
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
      stream.on('error', (err) => {
        res.destroy(err);
      });
      stream.pipe(res);
    }),
  );

  return router;
}
