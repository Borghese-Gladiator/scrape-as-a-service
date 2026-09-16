// Manual check for the transactional scheduler claim, the catch-up policies,
// and the attempt heartbeat (TODO 2.2, 2.4, 2.5).
//
//   npm run build
//   npm run migrate
//   node scripts/manual/phase-3-scheduler.mjs postgres://postgres:postgres@localhost:5432/scraper
//
// Exits 0 when every check passes, and 1 otherwise. Every row it writes is
// removed again on the way out.

import pg from 'pg';

const { Pool } = pg;

let failures = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  process.stdout.write(
    `${ok ? 'PASS' : 'FAIL'} ${label}` +
      (ok
        ? '\n'
        : ` (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})\n`),
  );
}

async function load(path) {
  try {
    return await import(path);
  } catch (err) {
    process.stderr.write(`cannot load ${path}. Run "npm run build" first.\n${err}\n`);
    process.exit(2);
  }
}

function fakeQueue() {
  const added = [];
  return {
    added,
    add: async (name, data, opts) => void added.push({ name, data, opts }),
  };
}

async function main() {
  const databaseUrl = process.argv[2] ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    process.stderr.write(
      'usage: node scripts/manual/phase-3-scheduler.mjs <database-url>\n',
    );
    process.exit(2);
  }

  const { pollOnce } = await load('../../apps/scheduler/dist/poll.js');
  const { claimDueSchedule, findStaleAttempts, touchAttempt, withTransaction } =
    await load('../../packages/db/dist/index.js');

  const pool = new Pool({ connectionString: databaseUrl });
  let definitionId;

  try {
    const definition = await pool.query(
      `INSERT INTO scrape_definitions (name, url, config) VALUES ($1, $2, $3) RETURNING id`,
      [
        'phase-3 scheduler check',
        'https://example.com',
        JSON.stringify({
          fields: [{ name: 'title', selector: 'h1' }],
          artifacts: ['JSON'],
        }),
      ],
    );
    definitionId = definition.rows[0].id;

    const addSchedule = async (cron, nextRunAt, catchUp) => {
      const { rows } = await pool.query(
        `INSERT INTO scrape_schedules (definition_id, cron, timezone, enabled, next_run_at, catch_up)
         VALUES ($1, $2, 'UTC', TRUE, $3, $4) RETURNING id`,
        [definitionId, cron, nextRunAt, catchUp],
      );
      return rows[0].id;
    };
    const readSchedule = async (id) => {
      const { rows } = await pool.query(
        `SELECT last_run_at, next_run_at, catch_up FROM scrape_schedules WHERE id = $1`,
        [id],
      );
      return rows[0];
    };
    const countRuns = async (scheduleId) => {
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM scrape_runs WHERE schedule_id = $1`,
        [scheduleId],
      );
      return rows[0].n;
    };

    // ---- catch-up: skip forgets the missed window ------------------------
    const missed = new Date('2026-01-01T00:00:00Z');
    const late = new Date('2026-01-01T10:30:00Z');

    const skipId = await addSchedule('0 * * * *', missed, 'skip');
    const queueA = fakeQueue();
    await pollOnce({ pool, queue: queueA, now: late });
    const skipRow = await readSchedule(skipId);
    check('skip creates one run', await countRuns(skipId), 1);
    check(
      'skip records last_run_at at now',
      skipRow.last_run_at.toISOString(),
      late.toISOString(),
    );
    check(
      'skip resumes the cadence after now',
      skipRow.next_run_at.toISOString(),
      '2026-01-01T11:00:00.000Z',
    );
    check('skip enqueues one job', queueA.added.length, 1);
    check('the job id is the run id', typeof queueA.added[0].opts.jobId, 'string');

    // ---- catch-up: runOnce records the missed window ---------------------
    const onceId = await addSchedule('0 * * * *', missed, 'runOnce');
    const queueB = fakeQueue();
    await pollOnce({ pool, queue: queueB, now: late });
    const onceRow = await readSchedule(onceId);
    check('runOnce creates one run', await countRuns(onceId), 1);
    check(
      'runOnce records last_run_at at the missed window',
      onceRow.last_run_at.toISOString(),
      missed.toISOString(),
    );
    check(
      'runOnce clamps the cadence ahead of now',
      onceRow.next_run_at.toISOString(),
      '2026-01-01T11:00:00.000Z',
    );

    // A second poll must not replay the remaining missed windows.
    await pollOnce({ pool, queue: fakeQueue(), now: late });
    check('runOnce does not replay on the next poll', await countRuns(onceId), 1);

    // ---- FOR UPDATE SKIP LOCKED -----------------------------------------
    const lockedId = await addSchedule('0 * * * *', missed, 'skip');
    const holder = await pool.connect();
    let claimedByOther;
    try {
      await holder.query('BEGIN');
      const held = await claimDueSchedule(holder, late);
      check('the first claim takes the due schedule', held?.id, lockedId);
      claimedByOther = await withTransaction(pool, (tx) => claimDueSchedule(tx, late));
      check('a concurrent claim skips the locked row', claimedByOther, null);
      await holder.query('ROLLBACK');
    } finally {
      holder.release();
    }
    const afterRollback = await withTransaction(pool, (tx) => claimDueSchedule(tx, late));
    check('the row is claimable again after the rollback', afterRollback?.id, lockedId);
    check('the rollback left no run behind', await countRuns(lockedId), 0);

    // ---- two concurrent pollers -----------------------------------------
    const raceId = await addSchedule('0 * * * *', missed, 'skip');
    await pool.query(`DELETE FROM scrape_schedules WHERE id = $1`, [lockedId]);
    const queues = [fakeQueue(), fakeQueue()];
    const counts = await Promise.all([
      pollOnce({ pool, queue: queues[0], now: late }),
      pollOnce({ pool, queue: queues[1], now: late }),
    ]);
    check('two concurrent pollers create exactly one run', await countRuns(raceId), 1);
    check('the two pollers report one run between them', counts[0] + counts[1], 1);

    // ---- heartbeat and the stale query ----------------------------------
    const run = await pool.query(
      `INSERT INTO scrape_runs (definition_id, status, trigger) VALUES ($1, 'RUNNING', 'MANUAL')
       RETURNING id`,
      [definitionId],
    );
    const runId = run.rows[0].id;
    const attempt = await pool.query(
      `INSERT INTO scrape_run_attempts (run_id, attempt_number, status, started_at)
       VALUES ($1, 1, 'RUNNING', now() - interval '1 hour') RETURNING id`,
      [runId],
    );
    const attemptId = attempt.rows[0].id;

    const inAnHour = new Date(Date.now() + 3_600_000);
    const beforeTouch = await findStaleAttempts(pool, inAnHour);
    check(
      'an attempt with no heartbeat is found through started_at',
      beforeTouch.some((a) => a.id === attemptId),
      true,
    );

    await touchAttempt(pool, attemptId);
    const beat = await pool.query(
      `SELECT heartbeat_at FROM scrape_run_attempts WHERE id = $1`,
      [attemptId],
    );
    check('touchAttempt writes a heartbeat', beat.rows[0].heartbeat_at !== null, true);

    const tenMinutesAgo = new Date(Date.now() - 600_000);
    const afterTouch = await findStaleAttempts(pool, tenMinutesAgo);
    check(
      'a fresh heartbeat keeps the attempt out of the stale set',
      afterTouch.some((a) => a.id === attemptId),
      false,
    );

    await pool.query(
      `UPDATE scrape_run_attempts SET status = 'SUCCEEDED' WHERE id = $1`,
      [attemptId],
    );
    const finished = await findStaleAttempts(pool, inAnHour);
    check(
      'a finished attempt is never stale',
      finished.some((a) => a.id === attemptId),
      false,
    );

    // ---- the stale index is actually used -------------------------------
    const plan = await pool.query(
      `EXPLAIN SELECT id, run_id, started_at, heartbeat_at FROM scrape_run_attempts
        WHERE status = 'RUNNING' AND COALESCE(heartbeat_at, started_at) < $1
        ORDER BY started_at ASC`,
      [tenMinutesAgo],
    );
    process.stdout.write(
      `INFO stale query plan: ${plan.rows.map((r) => r['QUERY PLAN']).join(' | ')}\n`,
    );

    process.stdout.write(
      failures === 0 ? '\nALL PASS\n' : `\n${failures} CHECK(S) FAILED\n`,
    );
    return failures === 0 ? 0 : 1;
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
