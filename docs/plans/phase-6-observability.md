# Plan — Phase 6: observability

## Brief

The platform gives no signal when a run fails. Logs are `console.log` lines with
no run id. Only the API has a health endpoint. A failed run records one error
string. The run page shows a stale status until the user reloads the browser.

Phase 6 closes TODO items 5.1, 5.2, 5.4 and 5.5.

## Changes

### 1. Structured logging (TODO 5.1)

- Add `pino` and `pino-pretty` to `packages/shared`.
- Add `packages/shared/src/logger.ts`. It exports `type Logger` and
  `createLogger(name)`.
  - The level comes from `LOG_LEVEL`. The default is `info`.
  - When `NODE_ENV` is not `production`, write through a `pino-pretty` stream.
    Use the stream form, not the transport form, because a transport starts a
    worker thread that complicates test teardown.
- Export the logger from `packages/shared/src/index.ts`.
- Replace every `console.log` and `console.error` in `apps/api`, `apps/worker`,
  `apps/scheduler` and `packages/db` with a logger call. Delete the
  `eslint-disable no-console` comments.
- Add `apps/api/src/logging.ts` with `requestLogger(logger)`. The middleware
  reads an inbound `X-Request-Id`, or generates one with `randomUUID`. It sets
  the `X-Request-Id` response header and logs method, path, status and duration
  when the response finishes.
- In the worker, bind a child logger with `runId` and `definitionId`, then a
  second child with `attemptId` after the attempt row exists. Pass that logger
  down to the scrape.

### 2. Health endpoints (TODO 5.2)

- Add `packages/shared/src/health.ts` with `startHealthServer(options)`. It runs
  a `node:http` server. `GET /health` returns 200 and
  `{ status: 'ok', uptimeSeconds, ...details }`. Every other path returns 404.
- Read the ports from `WORKER_HEALTH_PORT` (default 4001) and
  `SCHEDULER_HEALTH_PORT` (default 4002). Add both to `AppConfig`.
- The worker reports `activeJobs`. A counter increases when a job starts and
  decreases when it ends.
- Add compose healthchecks and published ports for the worker and the scheduler.

### 3. Failure diagnostics (TODO 5.5)

- Add `apps/worker/src/diagnostics.ts`:
  - `ScrapeDiagnostics` is `{ screenshot?: Buffer; html?: string; console?: unknown[] }`.
  - `collectConsole(page)` records page console messages, up to a fixed cap.
  - `attachDiagnostics(error, page, messages)` captures the screenshot and the
    HTML, attaches them to the error on a `diagnostics` property, and returns
    the error. Every capture runs inside its own `try`/`catch`, and the whole
    function runs inside one more `try`/`catch`, so a capture failure never
    changes the original error.
  - `getDiagnostics(error)` reads the property back.
- Edit `apps/worker/src/scrape.ts` as little as possible: attach the console
  listener after `newPage`, and add one `catch` block that calls
  `attachDiagnostics` and rethrows. A parallel branch rewrites this file.
- Add `uploadFailureDiagnostics` to `apps/worker/src/artifacts.ts`. It stores
  `failure-screenshot.png` (PNG), `failure-source.html` (HTML) and
  `failure-console.json` (JSON) under the run prefix.
- `apps/worker/src/process-run.ts` calls it in the catch block, inserts the
  artifact rows, then calls `finalizeFailure`. A failure of the upload itself is
  logged and swallowed.

### 4. UI refresh (TODO 5.4)

- Add `apps/web/src/components/RunDetailLive.tsx`, a client component. It holds
  the run in state, polls `GET /runs/:id` every 2 seconds while the status is
  not in `RUN_COMPLETE_STATUSES`, and stops on a terminal status.
- It shows a `role="status"` live indicator while the poll is active.
- `apps/web/src/app/runs/[id]/page.tsx` keeps the server render and renders
  `RunDetailLive` instead of `RunDetail`. The client component builds the
  artifact URL itself, because a server component cannot pass a function to a
  client component.

### 5. Documentation

- Add `LOG_LEVEL`, `WORKER_HEALTH_PORT` and `SCHEDULER_HEALTH_PORT` to
  `.env.example` and to the README environment table.
- Mark TODO items 5.1, 5.2, 5.4 and 5.5 as done.

## Tests

### Unit

- `packages/shared/src/__tests__/logger.test.ts` — `createLogger` honours
  `LOG_LEVEL`, falls back to `info`, and a child logger carries bound fields.
- `packages/shared/src/__tests__/health.test.ts` — start the server on port 0,
  fetch `/health`, assert 200 and the body, then close.
- `apps/worker/src/__tests__/diagnostics.test.ts` — `attachDiagnostics` attaches
  the three parts; a capture that throws leaves the error message unchanged; a
  failing run writes the three failure artifacts.
- `apps/web/src/components/__tests__/RunDetailLive.test.tsx` — a RUNNING run
  polls and re-renders as SUCCEEDED; a SUCCEEDED run never polls.

### Manual

`scripts/manual/phase-6-health.mjs` fetches `/health` from the api, the worker
and the scheduler. It prints each result and exits non-zero when one fails.

```bash
docker compose up -d --build
node scripts/manual/phase-6-health.mjs
```

Browser check for the live run page:

1. Open the web UI and create a definition.
2. Click **Run**, then open the run from the run history.
3. Confirm the live indicator appears while the status is QUEUED or RUNNING.
4. Wait. The status changes to SUCCEEDED without a browser reload, and the live
   indicator disappears.
5. Create a definition with a selector that does not exist and a bad URL. Run it.
   Confirm the failed run lists `failure-screenshot.png`, `failure-source.html`
   and `failure-console.json` in its artifacts.

## Verification

```bash
npm run typecheck
npm test
npm run check-types --workspace @scraper/web
npm run lint --workspace @scraper/web
```
