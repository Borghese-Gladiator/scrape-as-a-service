# Phase 1 — Unblock the UI and stabilize the run lifecycle

Written 2026-09-12 against commit `9092982`. Branch `phase-1-unblock`, base `main`.

## Brief

The documented README walkthrough cannot succeed today. The browser blocks every
write the UI makes, because the API sends no CORS headers. Four smaller defects
sit behind that one: a run loses its first start time on every retry, the
repositories claim a row always exists, the worker and the scheduler drop work on
`SIGTERM`, and a second run route duplicates the first.

This phase closes TODO items 2.1, 2.3, 2.6, 2.7, and 4.6.

## Changes

### 1. CORS on the API (TODO 2.1)

- Add `cors` and `@types/cors` to `apps/api`.
- Add `corsOrigins: string[]` to `AppConfig`. Read it from `CORS_ORIGINS`, a
  comma separated list. The default is `http://localhost:3000`.
- `createServer(pool, queue, storage, corsOrigins = ['http://localhost:3000'])`.
  The default keeps the existing route tests unchanged.
- Register the middleware in `apps/api/src/server.ts` before the routes.
- Add `CORS_ORIGINS` to `.env.example`, to the `api` service in
  `docker-compose.yml`, and to the environment table in `README.md`.

### 2. `started_at` survives a retry (TODO 2.7)

`updateRunStatus` in `packages/db/src/repositories/runs.ts` writes
`started_at = COALESCE(started_at, $3)` when the status becomes RUNNING. The
first attempt stamps the time. Every later attempt keeps it.

### 3. Repositories report a missing row (TODO 2.6)

Replace every `return rows[0]!` with `return rows[0] ?? null`. These functions
now return `T | null`:

`createRun`, `updateRunStatus`, `setScheduleEnabled`, `advanceSchedule`,
`insertAttempt`, `finishAttempt`, `insertArtifact`, `createDefinition`,
`createSchedule`.

Call sites that use the value handle the null:

| Call site | Action on null |
| --- | --- |
| `apps/api/src/routes/definitions.ts` — `createDefinition` | `HttpError(500, 'failed to create the definition')` |
| `apps/api/src/routes/schedules.ts` — `createSchedule` | `HttpError(500, 'failed to create the schedule')` |
| `apps/api/src/routes/schedules.ts` — `setScheduleEnabled` | `HttpError(404, 'schedule not found')` (already present) |
| `apps/api/src/routes/runs.ts` — `createRun` | `HttpError(500, 'failed to create the run')` |
| `apps/worker/src/process-run.ts` — `insertAttempt` | `Error('failed to create an attempt for run <id>')` |
| `apps/worker/src/process-run.ts` — `updateRunStatus` to RUNNING | `Error('run not found: <id>')` |
| `apps/scheduler/src/poll.ts` — `createRun` | `Error('failed to create a run for schedule <id>')` |

An INSERT that returns no row is a server fault, not a missing resource, so the
three creation routes answer 500. Only the schedule lookup answers 404.

### 4. Graceful shutdown (TODO 2.3)

Add `packages/shared/src/shutdown.ts` with `onShutdown(close)`. It listens for
`SIGTERM` and `SIGINT`, runs `close` one time only, and exits with code 0. A
15 second timer exits the process even when `close` hangs.

- `apps/worker/src/index.ts` closes the BullMQ worker, then every browser that
  is still open, then the Postgres pool. The worker tracks each browser it
  launches in a `Set` and drops it on the `disconnected` event. `worker.close()`
  closes the Redis connection that BullMQ owns.
- `apps/scheduler/src/index.ts` stops the interval, waits for the tick that is
  in flight, closes the queue, then closes the Postgres pool. `queue.close()`
  closes the Redis connection.

### 5. One run route (TODO 4.6)

`POST /runs` accepts an optional `trigger` field. The values are `MANUAL` and
`API`. The default is `MANUAL`. Any other value answers 400. `SCHEDULE` stays
out of the API, because only the scheduler writes it. Delete
`POST /runs/api-trigger`. Document `POST /runs` in `README.md`.

## Tests

### Unit

| File | What it proves |
| --- | --- |
| `apps/api/src/__tests__/cors.route.test.ts` | A preflight `OPTIONS /definitions` from an allowed origin answers with `Access-Control-Allow-Origin`. A disallowed origin gets no such header. |
| `packages/db/src/__tests__/started-at.test.ts` | `updateRunStatus` sends `COALESCE(started_at, $3)`, and a second RUNNING transition keeps the first start time. |
| `packages/db/src/__tests__/missing-rows.test.ts` | `updateRunStatus` and `setScheduleEnabled` return `null` when no row matches. |
| `apps/api/src/__tests__/runs.route.test.ts` | `POST /runs` records the `API` trigger on request, and answers 400 for an unknown trigger. |

Run them with `npm test`.

### Manual

`scripts/manual/phase-1-cors.mjs` checks the CORS headers against a live API.

1. Start the stack: `docker compose up -d --build`.
2. Run the script: `node scripts/manual/phase-1-cors.mjs`.
3. To point it at another API, pass a base URL:
   `node scripts/manual/phase-1-cors.mjs http://localhost:54000`.

The script sends a preflight `OPTIONS /definitions` with the header
`Origin: http://localhost:3000` and prints every CORS response header. It then
sends a real `POST /definitions` with the same origin and prints the status.
Expect `Access-Control-Allow-Origin: http://localhost:3000` on both, and status
201 on the POST.

The end-to-end check is the README walkthrough. Open http://localhost:3000,
create a definition, run it, and download an artifact. The browser console shows
no CORS error.
