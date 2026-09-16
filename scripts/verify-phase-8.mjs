import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'packages', 'db', 'src', 'repositories', 'definitions.ts');
const GOOD = "const COLUMNS = 'id, name, url, config, created_at';";
const BAD = "const COLUMNS = 'id, name, urlx, config, created_at';";

function runIntegration() {
  const result = spawnSync('npm', ['run', 'test:integration'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, INTEGRATION_REQUIRED: '1' },
  });
  return result.status ?? 1;
}

function patch(from, to) {
  const source = readFileSync(target, 'utf8');
  if (!source.includes(from)) {
    throw new Error(`${target} does not contain the expected line: ${from}`);
  }
  writeFileSync(target, source.replace(from, to), 'utf8');
}

console.log('\n=== step 1: introduce a SQL typo (url -> urlx) ===');
patch(GOOD, BAD);

let failed = 1;
try {
  failed = runIntegration();
} finally {
  console.log('\n=== step 2: restore the file ===');
  patch(BAD, GOOD);
}

if (failed === 0) {
  console.error('\nFAIL: the integration suite passed with a SQL typo in place.');
  process.exit(1);
}
console.log(`\nOK: the integration suite failed with the typo (exit code ${failed}).`);

console.log('\n=== step 3: rerun the suite on the restored file ===');
const restored = runIntegration();
if (restored !== 0) {
  console.error(`\nFAIL: the restored suite still fails (exit code ${restored}).`);
  process.exit(1);
}
console.log('\nOK: the restored suite passes. The pipeline catches a real defect.');
