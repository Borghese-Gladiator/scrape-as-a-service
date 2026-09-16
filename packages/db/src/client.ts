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

/**
 * Minimal connection surface shared by pg.Pool and a test double. A client is
 * a Queryable that must be released back to the pool.
 */
export interface Connectable {
  connect(): Promise<Queryable & { release(): void }>;
}

/**
 * Run `fn` inside a single transaction on one connection. Commits on return,
 * rolls back on a throw, and always releases the connection.
 */
export async function withTransaction<T>(
  pool: Connectable,
  fn: (tx: Queryable) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
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
