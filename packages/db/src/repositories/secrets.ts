import type { Queryable } from '../client.js';
import type { SecretMeta } from '../types.js';

/** Never include `ciphertext`. A caller that needs it asks for it by name. */
const META_COLUMNS = 'id, name, created_at, updated_at';

export async function upsertSecret(
  db: Queryable,
  name: string,
  ciphertext: string,
): Promise<SecretMeta> {
  const { rows } = await db.query<SecretMeta>(
    `INSERT INTO secrets (name, ciphertext)
     VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, updated_at = now()
     RETURNING ${META_COLUMNS}`,
    [name, ciphertext],
  );
  return rows[0]!;
}

export async function listSecrets(db: Queryable): Promise<SecretMeta[]> {
  const { rows } = await db.query<SecretMeta>(
    `SELECT ${META_COLUMNS} FROM secrets ORDER BY name ASC`,
  );
  return rows;
}

export async function getSecretCiphertext(db: Queryable, name: string): Promise<string | null> {
  const { rows } = await db.query<{ ciphertext: string }>(
    'SELECT ciphertext FROM secrets WHERE name = $1',
    [name],
  );
  return rows[0]?.ciphertext ?? null;
}

export async function getSecretCiphertexts(
  db: Queryable,
  names: string[],
): Promise<Record<string, string>> {
  if (names.length === 0) return {};
  const { rows } = await db.query<{ name: string; ciphertext: string }>(
    'SELECT name, ciphertext FROM secrets WHERE name = ANY($1::text[])',
    [names],
  );
  return Object.fromEntries(rows.map((row) => [row.name, row.ciphertext]));
}

export async function deleteSecret(db: Queryable, id: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    'DELETE FROM secrets WHERE id = $1 RETURNING id',
    [id],
  );
  return rows.length > 0;
}
