# Plan: Node/TypeScript backend services (apps/api, apps/worker, apps/scheduler)

## Brief
Implement the three backend services against the shared foundation (packages/db, packages/shared):
- **apps/api** (Express): REST for definitions, schedules, runs (MANUAL/API trigger), run detail, artifacts list + streamed download.
- **apps/worker** (BullMQ Worker + Playwright): per-job attempt lifecycle, isolated browser context, declarative scrape, build+upload artifacts, run/attempt status transitions, retry-per-attempt, mark FAILED when retries exhausted.
- **apps/scheduler**: interval poll of due schedules -> create SCHEDULE run -> enqueue -> advance next_run_at.

## Changes
### Root
- add `express`, `@playwright/test`/`playwright`, `supertest`, `@types/express`, `@types/supertest` deps (per-app)
- extend root `typecheck` script to include apps

### apps/api
- package.json, tsconfig.json (refs db + shared), Dockerfile
- src/http.ts (asyncHandler + error middleware)
- src/routes/{definitions,schedules,runs,artifacts}.ts
- src/server.ts (createServer + startApi)

### apps/worker
- package.json, tsconfig.json, Dockerfile
- src/scrape.ts (runScrape — declarative Playwright)
- src/artifacts.ts (toCsv, buildAndUploadArtifacts)
- src/process-run.ts (processRun + finalizeFailure)
- src/index.ts (startWorker)

### apps/scheduler
- package.json, tsconfig.json, Dockerfile
- src/poll.ts (pollOnce)
- src/index.ts (startScheduler)

## Tests (vitest)
### Unit
- apps/worker/src/__tests__/process-run.test.ts — success path (attempt inserted, RUNNING->SUCCEEDED, artifact metadata), failure path (error on attempt, new attempt per retry, FAILED only when retries exhausted). DB/storage/scrape mocked.
- apps/scheduler/src/__tests__/poll.test.ts — due enabled schedule creates SCHEDULE run + advances next_run_at; disabled/future does not.
- apps/api/src/__tests__/runs.route.test.ts — manual-run endpoint enqueues QUEUED run (mocked queue/db) via supertest.
- apps/api/src/__tests__/definitions.route.test.ts — declarative scrape config parsing (valid + invalid rejected).

### Manual / targeted checks
- tsc typecheck apps/api, apps/worker, apps/scheduler
- vitest run (all)
</content>
