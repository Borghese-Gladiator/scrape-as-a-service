# Scraper Monorepo

A declarative web-scraping platform built as an npm-workspaces monorepo.

## Layout

```
packages/
  db/       PostgreSQL schema, migrations, migration runner, typed data-access repositories
  shared/   config loader, BullMQ queue, MinIO/S3 storage, cron next-run helper, scrape-config validation
apps/
  api/        REST service (Express)
  worker/     BullMQ worker + Playwright scraper
  scheduler/  interval poller enqueuing due schedules
  web/        Next.js frontend
```


## Prerequisites

- Docker + Docker Compose v2 (the only requirement to run the full stack)
- Node >= 20 (only for local, non-Docker development / running tests)

## Run the whole stack (Docker Compose)

```bash
cp .env.example .env
docker compose up -d --build
```

This boots `postgres`, `redis`, `minio`, `api`, `web`, `scheduler`, and `worker`.
On boot the `api` service applies the database migrations and ensures the MinIO
bucket exists (a one-shot `minio-bootstrap` also creates the bucket). Ordering is
enforced via healthchecks + `depends_on`: `api` waits for postgres/redis/minio to
be healthy, and `web`/`worker`/`scheduler` wait for `api`.

Once up:

| Service | URL |
| --- | --- |
| Web UI | http://localhost:3000 |
| API | http://localhost:4000 |
| MinIO console | http://localhost:9001 (user/pass from `.env`) |

Check status and logs:

```bash
docker compose ps
docker compose logs -f api worker scheduler
```

### Scale workers

Workers consume from a shared BullMQ queue and hold no host port, so they scale
horizontally:

```bash
docker compose up -d --scale worker=5
docker compose ps worker   # 5 replicas
```

Tear down (add `-v` to also drop the postgres/minio volumes):

```bash
docker compose down
```

### Port conflicts

Host ports are configurable in `.env` so the stack can coexist with other local
services. If `3000`/`4000`/`5432`/`6379`/`9000`/`9001` are already taken, remap
the host side in `.env` (the container-internal ports and service-to-service URLs
are unaffected):

```env
API_PORT=54000
WEB_PORT=53000
MINIO_PORT=59000
MINIO_CONSOLE_PORT=59001
POSTGRES_PORT=55432
REDIS_PORT=56379
# NEXT_PUBLIC_API_BASE_URL is baked into the browser bundle at build time, so it
# must match the remapped API_PORT — rebuild web after changing it.
NEXT_PUBLIC_API_BASE_URL=http://localhost:54000
API_BASE_URL=http://localhost:54000
```

Then `docker compose build web && docker compose up -d`.

## End-to-end walkthrough

1. Open http://localhost:3000 → **New definition**. Give it a name, a reachable
   URL (e.g. `https://example.com`), a row selector / field selectors, and check
   the **JSON**, **CSV**, and **PNG** artifacts. Create it.
2. On the definition page click **Run**. Open the run from **Run history**: it
   transitions `QUEUED → RUNNING → SUCCEEDED` with an attempt recorded.
3. On a `SUCCEEDED` run, download the JSON / CSV / PNG artifacts. Objects live in
   MinIO under `runs/<run-id>/` (visible in the MinIO console).
4. **Failure/retry:** create a definition with an unreachable URL
   (e.g. `https://does-not-exist.invalid`) and run it. Multiple
   `ScrapeRunAttempt` rows are created with exponential backoff; after retries are
   exhausted the run ends `FAILED` with the error recorded on each attempt.
5. **Schedule:** on a definition, add a cron schedule (with timezone) and enable
   it. When it comes due the `scheduler` creates a `SCHEDULE`-triggered run that
   the worker picks up.
6. **Stale run:** start a run, then `docker compose kill worker`. The attempt
   stops its heartbeat. Within `STALE_ATTEMPT_MINUTES` the scheduler marks the
   attempt and the run `FAILED` with the error code `STALE`.

## Run reliability

Every run reaches a terminal status, through one of four paths.

| Failure | Mechanism |
| --- | --- |
| A scrape that never settles | `RUN_TIMEOUT_MS` bounds the scrape inside the worker. The run fails with the code `TIMEOUT`. |
| A worker that dies mid-job | The attempt stops its 15-second heartbeat. The scheduler sweeper fails the attempt and the run with the code `STALE` after `STALE_ATTEMPT_MINUTES`. |
| Two schedulers, one due schedule | The poller claims the schedule with `SELECT ... FOR UPDATE SKIP LOCKED`, and creates the run and advances the schedule in that same transaction. Exactly one run is created. |
| A scheduler outage | The schedule's `catchUp` policy decides. `skip` forgets the missed windows. `runOnce` records one run against the oldest missed window, then resumes the cadence. |

Every failure carries a code from a closed set: `TIMEOUT`, `SELECTOR_NOT_FOUND`,
`NAVIGATION_FAILED`, `AUTH_FAILED`, `LIMIT_EXCEEDED`, `STORAGE_FAILED`, `STALE`,
`UNKNOWN`. The code is stored on the attempt as `error_code`.

`POST /schedules` accepts `catchUp` with the value `skip` (the default) or
`runOnce`.

Each worker process launches one Chromium and reuses it. Each job takes its own
browser context, which stays the isolation boundary.

To check the sweeper against a real database:

```bash
npm run build
node scripts/manual/phase-3-stale.mjs "$DATABASE_URL"
```

## Local development (without Docker for the app services)

```bash
cp .env.example .env
npm install
npm run typecheck
npm test
```

Bring up just the infra dependencies with Docker and run services with `npm`:

```bash
docker compose up -d postgres redis minio minio-bootstrap
npm run migrate
npm run dev --workspace @scraper/web   # etc.
```

## Migrations

Apply the SQL migrations against the database in `DATABASE_URL`:

```bash
npm run migrate
```

Inside Docker, the migration runner is invoked as:

```bash
node packages/db/dist/migrate.js
```

The runner is idempotent: it records applied migrations in a `schema_migrations`
table and only applies pending files, in filename order.

## Environment

All configuration is read from the environment (see `.env.example`):

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Redis connection for BullMQ |
| `MINIO_ENDPOINT` / `MINIO_PORT` / `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` / `MINIO_BUCKET` / `MINIO_USE_SSL` | Object storage |
| `API_PORT` / `WEB_PORT` | Service ports |
| `SCHEDULER_INTERVAL_MS` | Scheduler poll interval |
| `WORKER_CONCURRENCY` | Worker job concurrency |
| `RUN_TIMEOUT_MS` | Hard limit on one scrape, in milliseconds (default `120000`) |
| `STALE_ATTEMPT_MINUTES` | How long an attempt may go without a heartbeat before the scheduler fails it (default `10`) |
| `NEXT_PUBLIC_API_BASE_URL` | Base URL the web frontend uses to reach the `api` service (falls back to `API_BASE_URL`, then `http://localhost:4000`) |

## Web frontend (`apps/web`)

Next.js + TypeScript UI over the `api` service: create/list scrape
definitions, add cron schedules (timezone + enable toggle), trigger manual
runs, and inspect run history with per-run attempts, failure info, and
artifact download links.

```bash
# with the api service running on :4000
npm run dev --workspace @scraper/web        # http://localhost:3000

npm run check-types --workspace @scraper/web
npm run lint --workspace @scraper/web
npm run build --workspace @scraper/web
npm run test --workspace @scraper/web
```

Manual flow: create a definition → open it → add a schedule and toggle
enable/disable → click **Run** → open the run from history → view attempts and
download artifacts for a completed run.
