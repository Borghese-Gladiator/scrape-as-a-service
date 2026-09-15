import { getSecretCiphertexts, type Queryable } from '@scraper/db';
import { decryptSecret } from '@scraper/shared';

/**
 * Decrypt the named secrets. The worker is the only process that holds a path
 * to `decryptSecret`; the API stores a ciphertext and never reads it back. A
 * name with no row is left out, and the consumer reports `AUTH_FAILED`.
 */
export async function loadSecrets(
  db: Queryable,
  names: string[],
): Promise<Record<string, string>> {
  if (names.length === 0) return {};
  const ciphertexts = await getSecretCiphertexts(db, names);
  const secrets: Record<string, string> = {};
  for (const [name, ciphertext] of Object.entries(ciphertexts)) {
    secrets[name] = decryptSecret(ciphertext);
  }
  return secrets;
}
