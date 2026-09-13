import { Readable } from 'node:stream';
import { Router } from 'express';
import archiver from 'archiver';
import type { Pool } from 'pg';
import { getArtifact, getRun, listArtifacts } from '@scraper/db';
import type { Artifact } from '@scraper/db';
import type { StorageClient } from '@scraper/shared';
import { asyncHandler, HttpError } from '../http.js';

/**
 * Open the object only when the archive reaches this entry. The generator body
 * does not run until the first read, so the archive holds one object stream at
 * a time instead of one per artifact.
 */
function lazyObjectStream(open: () => Promise<NodeJS.ReadableStream>): Readable {
  return Readable.from(
    (async function* () {
      const source = await open();
      for await (const chunk of source) yield chunk;
    })(),
  );
}

function artifactFilename(artifact: Artifact): string {
  return artifact.name ?? artifact.object_key.split('/').pop() ?? artifact.id;
}

function entryName(artifact: Artifact, used: Set<string>): string {
  const base = artifactFilename(artifact);
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const extension = dot > 0 ? base.slice(dot) : '';
  let suffix = 2;
  while (used.has(`${stem}-${suffix}${extension}`)) suffix += 1;
  const unique = `${stem}-${suffix}${extension}`;
  used.add(unique);
  return unique;
}

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
   * Stream the whole run as one archive. The route opens one object at a time
   * and the bytes leave the process as they arrive, so a run of hundreds of
   * screenshots never sits in memory. `store` skips deflate, which buys
   * nothing on a PNG or a PDF.
   */
  router.get(
    '/runs/:runId/artifacts.zip',
    asyncHandler(async (req, res) => {
      const runId = req.params.runId ?? '';
      const run = await getRun(pool, runId);
      if (!run) {
        throw new HttpError(404, 'run not found');
      }
      const artifacts = await listArtifacts(pool, runId);
      if (artifacts.length === 0) {
        throw new HttpError(404, 'run has no artifacts');
      }

      const archive = archiver('zip', { store: true });
      archive.on('error', (err) => {
        res.destroy(err);
      });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="run-${runId}.zip"`);
      archive.pipe(res);

      const used = new Set<string>();
      for (const artifact of artifacts) {
        archive.append(lazyObjectStream(() => storage.getStream(artifact.object_key)), {
          name: entryName(artifact, used),
        });
      }
      await archive.finalize();
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
      res.setHeader('Content-Disposition', `attachment; filename="${artifactFilename(artifact)}"`);
      stream.on('error', (err) => {
        res.destroy(err);
      });
      stream.pipe(res);
    }),
  );

  return router;
}
