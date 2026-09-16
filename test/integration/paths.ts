import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export function repoRoot(): string {
  return join(here, '..', '..');
}

export function migrationsDir(): string {
  return join(repoRoot(), 'packages', 'db', 'migrations');
}
