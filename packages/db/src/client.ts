import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { loadConfig, type AppConfig } from '@scraper/shared';

/**
 * Minimal query surface shared by pg.Pool and pg.PoolClient. Repositories
 * depend on this so they can run against a pool, a transaction client, or a
 * test double.
 */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
}

let poolSingleton: Pool | undefined;

export function getPool(config: AppConfig = loadConfig()): Pool {
  if (!poolSingleton) {
    poolSingleton = new Pool({ connectionString: config.databaseUrl });
  }
  return poolSingleton;
}

export async function closePool(): Promise<void> {
  if (poolSingleton) {
    await poolSingleton.end();
    poolSingleton = undefined;
  }
}
