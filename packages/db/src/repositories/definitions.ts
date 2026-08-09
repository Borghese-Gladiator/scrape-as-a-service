import type { Queryable } from '../client.js';
import type { CreateDefinitionInput, ScrapeDefinition } from '../types.js';

const COLUMNS = 'id, name, url, config, created_at';

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

export async function listDefinitions(db: Queryable): Promise<ScrapeDefinition[]> {
  const { rows } = await db.query<ScrapeDefinition>(
    `SELECT ${COLUMNS} FROM scrape_definitions ORDER BY created_at DESC`,
  );
  return rows;
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
