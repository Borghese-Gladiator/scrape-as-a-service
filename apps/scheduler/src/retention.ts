import { deleteRun, findRunsOlderThan, listArtifacts, type Queryable } from '@scraper/db';
import type { StorageClient } from '@scraper/shared';

const MS_PER_DAY = 86_400_000;

export const DEFAULT_SWEEP_LIMIT = 200;

export interface RetentionDeps {
  pool: Queryable;
  storage: StorageClient;
  now: Date;
  retentionDays: number;
  limit?: number;
}

export interface RetentionResult {
  runsDeleted: number;
  objectsDeleted: number;
}

/**
 * Delete runs older than `retentionDays`. The objects go first and the row
 * second, so a crash between the two leaves a row that the next sweep deletes.
 * The other order would leave an object that nothing references.
 */
export async function sweepRetention(deps: RetentionDeps): Promise<RetentionResult> {
  const { pool, storage, now, retentionDays } = deps;
  const result: RetentionResult = { runsDeleted: 0, objectsDeleted: 0 };
  if (retentionDays <= 0) return result;

  const before = new Date(now.getTime() - retentionDays * MS_PER_DAY);
  const runs = await findRunsOlderThan(pool, before, deps.limit ?? DEFAULT_SWEEP_LIMIT);

  for (const run of runs) {
    for (const artifact of await listArtifacts(pool, run.id)) {
      await storage.remove(artifact.object_key);
      result.objectsDeleted += 1;
    }
    if (await deleteRun(pool, run.id)) result.runsDeleted += 1;
  }
  return result;
}
