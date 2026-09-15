# Plan — Phase 3, run reliability

Covers TODO items 2.2, 2.4, 2.5, 2.8, 2.9 and 4.7.

## Brief

The platform loses runs. A worker that dies leaves a run in RUNNING forever. A
scrape that never settles holds a worker slot forever. Two scheduler replicas
create two runs for one schedule. A scheduler outage drops every missed window
with no record. Every failure is recorded with the error code `Error`.

This phase makes a run reach a terminal status in every case, and gives each
failure a name.

## Changes

### 1. Migration `0003_run_reliability.sql`

Another branch owns `0002_step_programs.sql`, so this file takes the number
0003.

- `scrape_run_attempts.heartbeat_at TIMESTAMPTZ`.
- `scrape_schedules.catch_up TEXT NOT NULL DEFAULT 'skip'`.
- A partial index on `COALESCE(heartbeat_at, started_at)` for RUNNING attempts.
  The index supports the stale query, which reads exactly that expression.

`packages/db/src/types.ts` gains `heartbeat_at`, `catch_up`, and the
`CatchUpPolicy` type. Every `COLUMNS` constant that lists the changed tables
gains the new column.

### 2. Heartbeat and stale sweeper (TODO 2.2)

- `touchAttempt(db, id)` in `packages/db/src/repositories/attempts.ts` sets
  `heartbeat_at = now()`.
- `findStaleAttempts(db, threshold)` returns RUNNING attempts whose
  `COALESCE(heartbeat_at, started_at)` is older than the threshold.
- `processRun` starts a 15-second timer after it creates the attempt, and stops
  the timer in a `finally`. The timer covers the whole life of the job, not only
  the scrape. A failed heartbeat write never fails the job.
- `apps/scheduler/src/sweep.ts` holds `sweepOnce(deps)`. The deps are a
  `Queryable`, a `now: Date` clock, and `staleAttemptMinutes`. This is the same
  shape as `pollOnce`. For each stale attempt the sweeper marks the attempt
  FAILED with the code `STALE`, and marks its run FAILED.
- `apps/scheduler/src/index.ts` calls `sweepOnce` in the same tick as `pollOnce`.

New environment variable: `STALE_ATTEMPT_MINUTES`, default 10.

### 3. Per-run timeout (TODO 2.8)

New environment variable `RUN_TIMEOUT_MS`, default 120000, read into
`AppConfig.runTimeoutMs` and passed into `ProcessRunDeps`.

`processRun` races the scrape against a timer. On a timeout it throws
`ScrapeError('TIMEOUT', ...)`, closes the scrape context, and lets
`finalizeFailure` record the failure.

**Interaction with the BullMQ stall window.** The worker sets
`stalledInterval: 30_000` and `maxStalledCount: 1`. BullMQ calls a job stalled
when the worker stops renewing the job lock, which happens when the worker
process dies or blocks its event loop. BullMQ then moves the job back to wait
and another worker may run it a second time. The run timeout is enforced inside
the processor, so the worker keeps renewing the lock for the whole wait, and
BullMQ never sees a stall. The timeout rejects the processor promise, so BullMQ
records a normal failure and retries under `attempts: 3`. This is the reason the
timeout lives in the processor and not in a watchdog outside it. The default of
120000 ms also bounds a single job well inside the 3-attempt budget.

When the worker process dies the lock stops, BullMQ recovers the job, and the
sweeper from change 2 closes out the orphan attempt. The two mechanisms cover
the two different failures.

### 4. One browser per worker (TODO 2.9)

`apps/worker/src/browser.ts` holds `createBrowserPool(launch)`. `get()` returns
a shared browser, launches it on the first call, and relaunches it when the
current browser reports `isConnected() === false`.

`ProcessRunDeps.launchBrowser` becomes `getBrowser: () => Promise<Browser>`.
`processRun` no longer calls `browser.close()`. It opens one context per job and
closes only that context. `apps/worker/src/index.ts` closes the browser on
SIGTERM and SIGINT.

`apps/worker/src/scrape.ts` changes as little as possible, because a parallel
branch rewrites the file. The context creation and the context teardown move out
of `runScrape` into `openScrapeSession` and `closeScrapeSession` in the same
file. `runScrape` then takes the session. This is the smallest change that lets
`processRun` own the context lifetime, which the timeout requires.

### 5. Scheduler race (TODO 2.4)

`withTransaction(pool, fn)` in `packages/db/src/client.ts` runs `BEGIN`, the
callback, and `COMMIT`, and rolls back on a throw.

`claimDueSchedule(db, now)` in the schedules repository selects one due
schedule with `FOR UPDATE SKIP LOCKED`.

`pollOnce` claims one schedule per transaction. Inside the transaction it
creates the run and advances the schedule. It enqueues the BullMQ job after the
commit, so the queue never holds a job for a run that rolled back. The loop
repeats until no schedule is claimed, with a cap of 100 claims per poll.

A second poller that runs at the same time skips the locked row, and after the
commit the row is no longer due. Exactly one run is created.

### 6. Missed windows (TODO 2.5)

The `catch_up` column takes the values `skip` and `runOnce`.

| Policy | `last_run_at` becomes | `next_run_at` becomes |
| --- | --- | --- |
| `skip` | `now` | the next cron time after `now` |
| `runOnce` | the missed window, that is the old `next_run_at` | the next cron time after that missed window |

Both policies create exactly one run. The policy decides what the schedule
records. `skip` forgets the missed windows. `runOnce` records the run against
the missed window, so the history shows which window it belongs to.

`runOnce` clamps: when the computed next time is not after `now`, the poller
falls back to the next cron time after `now`. Without the clamp the poller
replays every missed window, one per poll, which is a different policy.

`POST /schedules` accepts `catchUp` and rejects any value outside the two.

### 7. Error taxonomy (TODO 4.7)

`packages/shared/src/errors.ts` holds `ScrapeErrorCode`, `ScrapeError`, and
`toErrorCode`. `toErrorCode` returns the code of a `ScrapeError`, maps a
Playwright `TimeoutError` by its `name` to `TIMEOUT`, and otherwise returns
`UNKNOWN`. The match on `name` keeps `packages/shared` free of a Playwright
dependency.

`process-run.ts` drops its local `errorCode` helper and uses `toErrorCode`.

Typed throw sites:

- `scrape.ts` throws `NAVIGATION_FAILED` when `page.goto` fails.
- `artifacts.ts` throws `STORAGE_FAILED` when an upload fails.
- `process-run.ts` throws `TIMEOUT` when the run timer fires.
- `sweep.ts` records `STALE`.

## Tests

### Unit

| File | Cases |
| --- | --- |
| `apps/scheduler/src/__tests__/sweep.test.ts` | An attempt inside the window survives. An attempt outside the window fails with code `STALE` and its run becomes FAILED. A null heartbeat falls back to `started_at`. |
| `apps/scheduler/src/__tests__/poll.test.ts` | The existing cases, over a fake pool with a transaction. Two concurrent pollers over one fake transaction create exactly one run; the fake models `SKIP LOCKED` by returning no rows for the second claim. A catch-up case parametrized over `skip` and `runOnce`. |
| `apps/worker/src/__tests__/process-run.test.ts` | The existing cases. A scrape that never resolves fails with code `TIMEOUT`. Two jobs receive the same browser, and `processRun` never calls `browser.close()`. |
| `apps/worker/src/__tests__/browser.test.ts` | The pool launches once, and relaunches after a disconnect. |
| `packages/shared/src/__tests__/errors.test.ts` | `toErrorCode` over every code, over a Playwright `TimeoutError`, and over the fallback. |

### Manual

`scripts/manual/phase-3-stale.mjs` takes a database URL. It inserts a
definition, a run, and a RUNNING attempt with an old heartbeat. It runs the
sweeper once. It prints the run status and the attempt status. It exits
non-zero when the run is not FAILED with the code `STALE`.

`scripts/manual/phase-3-scheduler.mjs` covers the other body of new SQL, which
the unit suite never executes: the catch-up policies, `claimDueSchedule` with
`FOR UPDATE SKIP LOCKED` against two real connections, two concurrent pollers,
`touchAttempt`, and `findStaleAttempts`. It also prints the plan of the stale
query, to show that the partial index is used.

```bash
npm run build
npm run migrate
node scripts/manual/phase-3-stale.mjs postgres://postgres:postgres@localhost:5432/scraper
node scripts/manual/phase-3-scheduler.mjs postgres://postgres:postgres@localhost:5432/scraper
```

### Verification

```bash
npm run typecheck
npm test
```

Both manual scripts ran against Postgres 16 and passed. The migration applied
twice with no error, the partial index serves the stale query through an index
scan, and every check in the scheduler script passed. The real database
required no change to the implementation.
