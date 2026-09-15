// Manual check for the stale-attempt sweeper (TODO 2.2).
//
//   npm run build
//   npm run migrate
//   node scripts/manual/phase-3-stale.mjs postgres://postgres:postgres@localhost:5432/scraper
//
// Exits 0 when the sweeper fails the run with the code STALE, and 1 otherwise.

import pg from 'pg';

const { Pool } = pg;

const STALE_ATTEMPT_MINUTES = 10;

function usage() {
  process.stderr.write(
    'usage: node scripts/manual/phase-3-stale.mjs <database-url>\n' +
      '       (or set DATABASE_URL)\n',
  );
}

async function loadSweeper() {
  try {
    return (await import('../../apps/scheduler/dist/sweep.js')).sweepOnce;
  } catch (err) {
    process.stderr.write(`cannot load the sweeper. Run "npm run build" first.\n${err}\n`);
    process.exit(2);
  }
}

async function main() {
  const databaseUrl = process.argv[2] ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    usage();
    process.exit(2);
  }

  const sweepOnce = await loadSweeper();
  const pool = new Pool({ connectionString: databaseUrl });
  let definitionId;

  try {
    const definition = await pool.query(
      `INSERT INTO scrape_definitions (name, url, config)
       VALUES ($1, $2, $3) RETURNING id`,
      [
        'phase-3 stale check',
        'https://example.com',
        JSON.stringify({
          fields: [{ name: 'title', selector: 'h1' }],
          artifacts: ['JSON'],
        }),
      ],
    );
    definitionId = definition.rows[0].id;

    const run = await pool.query(
      `INSERT INTO scrape_runs (definition_id, status, trigger, started_at)
       VALUES ($1, 'RUNNING', 'MANUAL', now() - interval '1 hour') RETURNING id`,
      [definitionId],
    );
    const runId = run.rows[0].id;

    const attempt = await pool.query(
      `INSERT INTO scrape_run_attempts
         (run_id, attempt_number, status, worker_id, started_at, heartbeat_at)
       VALUES ($1, 1, 'RUNNING', 'dead-worker', now() - interval '1 hour', now() - interval '1 hour')
       RETURNING id`,
      [runId],
    );
    const attemptId = attempt.rows[0].id;

    process.stdout.write(`run ${runId} attempt ${attemptId} inserted as RUNNING\n`);

    const swept = await sweepOnce({
      pool,
      now: new Date(),
      staleAttemptMinutes: STALE_ATTEMPT_MINUTES,
    });
    process.stdout.write(`sweeper failed ${swept} attempt(s)\n`);

    const after = await pool.query(
      `SELECT r.status AS run_status,
              a.status AS attempt_status,
              a.error_code,
              a.error_message
         FROM scrape_runs r
         JOIN scrape_run_attempts a ON a.run_id = r.id
        WHERE r.id = $1`,
      [runId],
    );
    const row = after.rows[0];
    process.stdout.write(
      `run=${row.run_status} attempt=${row.attempt_status} ` +
        `code=${row.error_code} message=${row.error_message}\n`,
    );

    if (row.run_status !== 'FAILED' || row.error_code !== 'STALE') {
      process.stderr.write('FAIL: expected run=FAILED with code=STALE\n');
      return 1;
    }
    process.stdout.write('PASS\n');
    return 0;
  } finally {
    if (definitionId) {
      await pool.query('DELETE FROM scrape_definitions WHERE id = $1', [definitionId]);
    }
    await pool.end();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`${err?.stack ?? err}\n`);
    process.exit(1);
  },
);
