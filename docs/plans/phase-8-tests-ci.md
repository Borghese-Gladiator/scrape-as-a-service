# Phase 8 — integration tests, an end-to-end test, and CI

## Brief

The unit suite proves nothing about SQL. `packages/db` tests run against a fake
`pg` client, so no query text ever reaches Postgres. A column typo passes the
whole suite. Nothing runs against real Redis or real MinIO. There is no CI, no
root lint, and no root format.

This phase adds a second test suite that runs every repository query against a
real database, adds one end-to-end test over the real stack, adds a GitHub
Actions pipeline, and closes four developer-experience items.

Closes TODO 6.1, 6.2, 6.4, 7.1, 7.3, 7.4 and 7.5.

## Changes

### 1. Integration suite (TODO 6.1)

- `vitest.integration.config.ts` at the root. It includes
  `{packages,apps}/**/src/**/__itests__/**/*.itest.ts`. The unit config keeps
  `__tests__/**/*.test.ts`, so the two suites never overlap.
- `docker-compose.test.yml` brings up Postgres, Redis, and MinIO only. It uses
  the project name `scraper-test` and the host ports 55432, 56379, and 59000, so
  it never touches a developer stack on the default ports. It uses `tmpfs`
  volumes, so a teardown leaves no state.
- Root scripts: `test:integration`, `test:integration:up`,
  `test:integration:down`.
- `test/integration/env.ts` builds the test `AppConfig` from
  `TEST_DATABASE_URL`, `TEST_REDIS_URL`, and the `TEST_MINIO_*` variables, each
  with a default that matches `docker-compose.test.yml`.
- `test/integration/probe.ts` opens a TCP socket to each service with a short
  timeout. When a service is unreachable the global setup throws a message that
  names the service and the command to start it.
- A vitest `globalSetup` file probes the services, runs `runMigrations` against
  the test database, and creates the MinIO bucket.
- Every test truncates the five tables before it runs, so tests do not leak
  state. A single `resetDatabase` helper does this with one
  `TRUNCATE ... RESTART IDENTITY CASCADE`.
- `packages/db/src/__itests__/repositories.itest.ts` calls every exported
  function in `packages/db/src/repositories/*.ts` against the migrated schema.
- `packages/shared/src/__itests__/storage.itest.ts` puts an object, reads it
  back, and builds a presigned URL that resolves to the same bytes.
- `packages/shared/src/__itests__/queue.itest.ts` enqueues a job and reads it
  back from Redis.

Offline behavior: `npm test` never touches Docker. `npm run test:integration`
fails with a clear message that names the missing service and the command to
start it.

### 2. End-to-end test (TODO 6.2)

Location: `apps/api/src/__itests__/e2e.itest.ts`.

Reason for the location: the root integration config already includes
`{packages,apps}/**/src/**/__itests__/`. A top-level `e2e/` folder needs a
second include path and a second tsconfig for no gain. The test belongs to the
API contract, so it lives beside the API.

The test:

1. Serves a fixture page with `node:http` on an ephemeral port.
2. Starts the real Express app on an ephemeral port, against real Postgres,
   real Redis, and real MinIO.
3. Sends a cross-origin preflight `OPTIONS /definitions` and asserts the
   `Access-Control-Allow-Origin` header. This is the CORS guard.
4. `POST /definitions` with an `Origin` header, and asserts the response
   carries `Access-Control-Allow-Origin`.
5. `POST /runs` to trigger a run.
6. Runs one real BullMQ worker with a real Chromium browser.
7. Polls `GET /runs/:id` until the status is terminal.
8. `GET /runs/:id/artifacts`, then `GET /artifacts/:id/download`, and asserts
   the downloaded bytes.

CORS note: `apps/api/src/server.ts` on `main` has no CORS middleware, so step 3
cannot pass as the code stands. This phase adds the minimal `cors` middleware so
the branch is green. Phase 1 owns the same change, so expect a conflict in
`apps/api/src/server.ts`.

### 3. CI (TODO 6.4)

`.github/workflows/ci.yml` with two jobs.

- `static-and-unit`: `npm ci`, `npm run lint`, `npm run typecheck`,
  `npm run check-types --workspace @scraper/web`, `npm test`. No browsers.
- `integration`: Postgres, Redis, and MinIO as service containers.
  `npx playwright install --with-deps chromium`, then
  `npm run test:integration`. Only this job installs a browser.

Both jobs cache `~/.npm` with `actions/setup-node`.

### 4. Root lint and format (TODO 7.1)

- `eslint.config.js`, flat config, with `typescript-eslint`. The plan is the
  plain `recommended` set, not `recommendedTypeChecked`. Reason: the
  type-checked set needs a full program per file and the repository has five
  tsconfig projects. The plain set runs in about one second.
- `.prettierrc.json` and `.prettierignore`.
- Root scripts: `lint`, `lint:fix`, `format`, `format:check`.
- `apps/web` keeps `.eslintrc.json` and `next lint`. The root config ignores
  `apps/web`.
- The bulk Prettier run goes in its own commit.

### 5. `cron-parser` v5 (TODO 7.4)

`packages/shared/src/cron.ts` changes to
`import { CronExpressionParser } from 'cron-parser'` and
`CronExpressionParser.parse(expression, { currentDate, tz })`.
`packages/shared/src/__tests__/cron.test.ts` does not change.

### 6. Docker image pruning (TODO 7.3)

`apps/api/Dockerfile`, `apps/worker/Dockerfile`, and
`apps/scheduler/Dockerfile` become two-stage. The builder stage installs every
dependency and runs `tsc -b`. The runtime stage runs
`npm ci --omit=dev --ignore-scripts` and copies only the `dist` directories and
the `package.json` files. The worker runtime stage keeps the Playwright base
image, because that image carries the browsers.

### 7. Playwright prerequisite (TODO 7.5)

- The root script `postinstall:browsers` runs `npx playwright install chromium`.
- The README documents the script under local development. Nothing runs it
  automatically, because a browser download is 150 MB and must be a choice.

## Tests

### Unit

The existing unit suite must pass unchanged. `npm test`.

### Integration

```
npm run test:integration:up
npm run test:integration
npm run test:integration:down
```

Coverage, one test per exported repository function:

| File | Functions |
| --- | --- |
| `definitions.ts` | `createDefinition`, `listDefinitions`, `getDefinition` |
| `schedules.ts` | `createSchedule`, `listSchedules`, `setScheduleEnabled`, `findDueSchedules`, `advanceSchedule` |
| `runs.ts` | `createRun`, `updateRunStatus`, `getRun`, `getRunDetail`, `listRuns` |
| `attempts.ts` | `insertAttempt`, `finishAttempt`, `listAttempts` |
| `artifacts.ts` | `insertArtifact`, `listArtifacts`, `getArtifact` |

Plus `storage.itest.ts`, `queue.itest.ts`, and `e2e.itest.ts`.

### Manual

A Node script, `scripts/verify-phase-8.mjs`. It proves the pipeline catches a
real defect:

1. Read `packages/db/src/repositories/definitions.ts`.
2. Replace the column `url` with `urlx` in the `COLUMNS` constant.
3. Run `npm run test:integration`. Expect a non-zero exit code.
4. Restore the file.
5. Run `npm run test:integration`. Expect exit code 0.

The script prints each step and the result. The PR body records the output.

Docker check, run by hand:

```
docker build -f apps/api/Dockerfile .
docker build -f apps/worker/Dockerfile .
docker build -f apps/scheduler/Dockerfile .
```
