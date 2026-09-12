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
- Chromium for Playwright, for a local worker and for the end-to-end test:
  `npx playwright install chromium`. The Docker images already carry it.

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

## Local development (without Docker for the app services)

```bash
cp .env.example .env
npm install
npm run postinstall:browsers   # downloads Chromium; see the prerequisite below
npm run lint
npm run typecheck
npm test
```

Bring up just the infra dependencies with Docker and run services with `npm`:

```bash
docker compose up -d postgres redis minio minio-bootstrap
npm run migrate
npm run dev --workspace @scraper/web   # etc.
```

### Playwright browsers are a separate download

The worker drives a real Chromium. Docker images get it from the Playwright base
image, but a local worker and the end-to-end test do not. Install it once:

```bash
npx playwright install chromium
# or, the same thing through the workspace script:
npm run postinstall:browsers
```

Nothing installs the browser automatically, because the download is about 150 MB.
Without it the worker and the end-to-end test fail to launch a browser.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run lint` | ESLint over `packages/*`, `apps/api`, `apps/worker`, `apps/scheduler` |
| `npm run lint:fix` | The same, with autofix |
| `npm run format` | Prettier over the repository |
| `npm run format:check` | Prettier in check mode (used by review, not by CI) |
| `npm run typecheck` | `tsc -b` over every non-web project |
| `npm test` | The unit suite. Needs no Docker |
| `npm run test:integration:up` | Start Postgres, Redis, and MinIO for the integration suite |
| `npm run test:integration` | The integration and end-to-end suites |
| `npm run test:integration:down` | Stop and remove those services |
| `npm run postinstall:browsers` | `npx playwright install chromium` |

`apps/web` keeps its own configuration. Lint and typecheck it with
`npm run lint --workspace @scraper/web` and
`npm run check-types --workspace @scraper/web`.

## Tests

### Unit suite

```bash
npm test
```

It runs `vitest` over every `src/**/__tests__/**/*.test.ts` file, then the
`apps/web` suite. It uses fakes only, so it needs no Docker and no network.

### Integration and end-to-end suite

The integration suite runs every repository query against a real Postgres, and
exercises real Redis and real MinIO. The end-to-end test creates a definition
over HTTP, triggers a run, drives a real Chromium against a fixture site served
by the test, and downloads the artifacts.

```bash
npm run test:integration:up     # postgres :55432, redis :56379, minio :59000
npm run test:integration
npm run test:integration:down
```

`docker-compose.test.yml` publishes the three services on non-default host
ports and keeps their state in `tmpfs`, so it runs beside your own
`docker compose up` without a clash and leaves nothing behind.

When the services are not reachable the suite prints the reason and skips every
test, so the command stays usable offline. Set `INTEGRATION_REQUIRED=1` to make
an unreachable service a failure instead; CI sets it.

Override any endpoint with `TEST_DATABASE_URL`, `TEST_REDIS_URL`,
`TEST_MINIO_ENDPOINT`, `TEST_MINIO_PORT`, `TEST_MINIO_ACCESS_KEY`,
`TEST_MINIO_SECRET_KEY`, or `TEST_MINIO_BUCKET`.

### Continuous integration

`.github/workflows/ci.yml` runs on every push and every pull request:

1. `lint-typecheck-unit`: `npm ci`, `npm run lint`, `npm run typecheck`,
   `npm run check-types --workspace @scraper/web`, `npm test`.
2. `integration`: the same install, then `npx playwright install --with-deps
   chromium`, then `npm run test:integration` against Postgres, Redis, and MinIO
   service containers.

Only the second job downloads a browser.

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
