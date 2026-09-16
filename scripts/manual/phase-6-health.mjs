#!/usr/bin/env node
// Manual test for Phase 6: every service answers GET /health.
// Usage: node scripts/manual/phase-6-health.mjs

const TIMEOUT_MS = 5000;

const targets = [
  { name: 'api', url: `http://localhost:${process.env.API_PORT ?? '4000'}/health` },
  {
    name: 'worker',
    url: `http://localhost:${process.env.WORKER_HEALTH_PORT ?? '4001'}/health`,
  },
  {
    name: 'scheduler',
    url: `http://localhost:${process.env.SCHEDULER_HEALTH_PORT ?? '4002'}/health`,
  },
];

async function check(target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(target.url, { signal: controller.signal });
    const body = await res.json();
    const ok = res.status === 200 && body.status === 'ok';
    return { ...target, ok, detail: `${res.status} ${JSON.stringify(body)}` };
  } catch (err) {
    return { ...target, ok: false, detail: err.message };
  } finally {
    clearTimeout(timer);
  }
}

const results = await Promise.all(targets.map(check));

for (const result of results) {
  const mark = result.ok ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${result.name.padEnd(9)} ${result.url}`);
  console.log(`        ${result.detail}`);
}

const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.log(`\n${failed.length} of ${results.length} health checks failed.`);
  process.exit(1);
}

console.log(`\nAll ${results.length} health checks passed.`);
