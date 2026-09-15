import type { Queryable } from '../client.js';
import type { StoragePutResult } from '@scraper/shared';
import type { Artifact, ArtifactType } from '../types.js';

const COLUMNS =
  'id, run_id, type, name, step_index, object_key, content_type, size_bytes, created_at';

export async function insertArtifact(
  db: Queryable,
  runId: string,
  type: ArtifactType,
  put: StoragePutResult,
  name: string,
  stepIndex: number,
): Promise<Artifact | null> {
  const { rows } = await db.query<Artifact>(
    `INSERT INTO artifacts (run_id, type, name, step_index, object_key, content_type, size_bytes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${COLUMNS}`,
    [runId, type, name, stepIndex, put.objectKey, put.contentType, put.sizeBytes],
  );
  return rows[0] ?? null;
}

export async function listArtifacts(db: Queryable, runId: string): Promise<Artifact[]> {
  const { rows } = await db.query<Artifact>(
    `SELECT ${COLUMNS} FROM artifacts WHERE run_id = $1 ORDER BY created_at ASC`,
    [runId],
  );
  return rows;
}

export async function getArtifact(db: Queryable, id: string): Promise<Artifact | null> {
  const { rows } = await db.query<Artifact>(
    `SELECT ${COLUMNS} FROM artifacts WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}
