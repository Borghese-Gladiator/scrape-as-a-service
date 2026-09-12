import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { STEP_OPS } from '../steps';

/**
 * The web app mirrors the shared types instead of importing the shared package.
 * This test fails when a new verb lands in one list and not in the other.
 */
function readStepVerbs(relativePath: string): string[] {
  const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
  const start = source.indexOf('export type Step =');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('export interface ScrapeConfig', start);
  expect(end).toBeGreaterThan(start);
  return [...source.slice(start, end).matchAll(/op: '([A-Za-z]+)'/g)].map((match) => match[1]!);
}

describe('step verbs', () => {
  it('match between the shared package, the web types, and STEP_OPS', () => {
    const shared = readStepVerbs('../../../../../packages/shared/src/scrape-config.ts');
    const web = readStepVerbs('../types.ts');

    expect(shared.length).toBeGreaterThan(0);
    expect(web).toEqual(shared);
    expect([...STEP_OPS].sort()).toEqual([...shared].sort());
  });
});
