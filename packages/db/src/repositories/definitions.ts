import type { Queryable } from '../client.js';
import { decodeCursor, resolveLimit, toPage } from '../pagination.js';
import type {
  CreateDefinitionInput,
  Page,
  PageQuery,
  ScrapeDefinition,
  UpdateDefinitionInput,
} from '../types.js';

const COLUMNS = 'id, name, url, config, created_at, deleted_at';

export async function createDefinition(
  db: Queryable,
  input: CreateDefinitionInput,
): Promise<ScrapeDefinition> {
  const { rows } = await db.query<ScrapeDefinition>(
    `INSERT INTO scrape_definitions (name, url, config)
     VALUES ($1, $2, $3)
     RETURNING ${COLUMNS}`,
    [input.name, input.url, JSON.stringify(input.config)],
  );
  return rows[0]!;
}

/** One keyset page of live definitions. A soft-deleted row never appears. */
export async function listDefinitions(
  db: Queryable,
  query: PageQuery = {},
): Promise<Page<ScrapeDefinition>> {
  const limit = resolveLimit(query.limit);
  const cursor = decodeCursor(query.cursor);
  const values: unknown[] = cursor ? [cursor.createdAt, cursor.id, limit + 1] : [limit + 1];
  const after = cursor ? 'AND (created_at, id) < ($1, $2)' : '';
  const { rows } = await db.query<ScrapeDefinition>(
    `SELECT ${COLUMNS} FROM scrape_definitions
     WHERE deleted_at IS NULL ${after}
     ORDER BY created_at DESC, id DESC
     LIMIT $${values.length}`,
    values,
  );
  return toPage(rows, limit);
}

export async function getDefinition(
  db: Queryable,
  id: string,
): Promise<ScrapeDefinition | null> {
  const { rows } = await db.query<ScrapeDefinition>(
    `SELECT ${COLUMNS} FROM scrape_definitions WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function updateDefinition(
  db: Queryable,
  id: string,
  input: UpdateDefinitionInput,
): Promise<ScrapeDefinition | null> {
  const { rows } = await db.query<ScrapeDefinition>(
    `UPDATE scrape_definitions
     SET name = COALESCE($2, name),
         url = COALESCE($3, url),
         config = COALESCE($4::jsonb, config)
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING ${COLUMNS}`,
    [
      id,
      input.name ?? null,
      input.url ?? null,
      input.config === undefined ? null : JSON.stringify(input.config),
    ],
  );
  return rows[0] ?? null;
}

/** Soft delete. The runs and the artifacts of the definition stay readable. */
export async function softDeleteDefinition(
  db: Queryable,
  id: string,
  at: Date,
): Promise<ScrapeDefinition | null> {
  const { rows } = await db.query<ScrapeDefinition>(
    `UPDATE scrape_definitions
     SET deleted_at = $2
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING ${COLUMNS}`,
    [id, at],
  );
  return rows[0] ?? null;
}
