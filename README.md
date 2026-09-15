# Scraper Monorepo

A declarative web-scraping platform built as an npm-workspaces monorepo.

## Layout

```
packages/
  db/       PostgreSQL schema, migrations, migration runner, typed data-access repositories
  shared/   config loader, BullMQ queue, MinIO/S3 storage, cron next-run helper, scrape-config validation
apps/
  api/        REST service (Express)
  worker/     BullMQ worker + Playwright step interpreter
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
| Worker health | http://localhost:4001/health |
| Scheduler health | http://localhost:4002/health |
| MinIO console | http://localhost:9001 (user/pass from `.env`) |

Check status and logs:

```bash
docker compose ps
docker compose logs -f api worker scheduler
```

Every service has a compose healthcheck, so a crash-looping worker or scheduler
shows as `unhealthy` in `docker compose ps`. To check all three health endpoints
from the host in one step:

```bash
node scripts/manual/phase-6-health.mjs
```

### Scale workers

Workers consume from a shared BullMQ queue and hold no host port, so they scale
horizontally:

```bash
docker compose up -d --scale worker=5
docker compose ps worker   # 5 replicas
```

The `worker` service publishes its health port on the host. Remove that `ports`
entry from `docker-compose.yml` before you scale beyond one replica, because
several replicas cannot share one host port. The healthcheck itself runs inside
the container and keeps working.

Tear down (add `-v` to also drop the postgres/minio volumes):

```bash
docker compose down
```

The worker and the scheduler handle `SIGTERM` and `SIGINT`. On a stop the worker
drains the jobs it holds, closes any open browser, and closes its Postgres pool
and Redis connection. The scheduler finishes the poll it is in and closes the
same resources. Both give up after 15 seconds and exit anyway.

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
# The browser posts from the remapped WEB_PORT, so the API must allow that origin.
CORS_ORIGINS=http://localhost:53000
```

Then `docker compose build web && docker compose up -d`.

## Scrape definitions (config v2)

A scrape definition is data, never code. The platform never evaluates
JavaScript that a user supplies. Every capability is a step verb with a closed
schema, and `validateScrapeConfig` checks that schema before the API stores the
definition.

```ts
interface ScrapeConfig {
  version: 2;
  auth?: AuthConfig;   // Phase 4 executes this; the validator accepts it today
  steps: Step[];
  limits?: Limits;
  record?: boolean;    // record the context as one recording.webm artifact
}
```

### Step verbs

| Verb | Fields | What it does |
| --- | --- | --- |
| `goto` | `url?`, `waitUntil?` | Navigate. With no `url` it uses the definition URL. |
| `waitFor` | `selector`, `timeoutMs?`, `state?` | Wait for a selector in the current scope. |
| `click` | `selector`, `opens?`, `timeoutMs?`, `optional?` | Click the first match. `opens: 'newTab'` makes the new tab current. |
| `fill` | `selector`, `value?` \| `valueFrom?` | Type a literal, or a secret that `valueFrom` names. |
| `select` | `selector`, `value` | Pick an option. |
| `press` | `key` | Press a key. |
| `scroll` | `to`, `selector?` | Scroll to the bottom, or to an element. |
| `extract` | `name`, `rowSelector?`, `fields`, `emit?` | Read fields into `datasets[name]`. |
| `capture` | `as`, `name`, `fullPage?` | Capture the page as PNG, PDF, or HTML. |
| `forEach` | `rowSelector`, `max?`, `steps` | Run nested steps once per row, scoped to that row. |
| `openLink` | `selector`, `attribute?`, `steps` | Open the link target in a new page, run nested steps, close it. |
| `paginate` | `nextSelector`, `maxPages`, `steps` | Run nested steps, click next, repeat. |
| `goBack` | — | Close the current tab, or navigate back. |

`extract` writes one JSON file per dataset at the end of the run, named
`<name>.json`. It writes `<name>.csv` as well when `emit` holds `CSV`. A
dataset collects every row from every loop pass, so a paginated table becomes
one file.

### Artifact names

`capture.name` is a template. It accepts `{{index}}` (the zero-based `forEach`
counter, stable across pages), `{{page}}` (the one-based `paginate` counter),
and `{{row.<field>}}` (a field of the most recent `extract` in the same scope).
There is no expression support. The platform lowercases the result, replaces
every character outside `[a-z0-9._-]` with `-`, truncates it to 120 characters,
appends the extension, and suffixes `-2`, `-3` and so on for a repeat.

### Limits

| Limit | Default | Hard cap |
| --- | --- | --- |
| `maxDurationMs` | 120000 | 900000 |
| `maxSteps` | 500 | 10000 |
| `maxPages` | 50 | 500 |
| `maxArtifacts` | 200 | 2000 |

The validator clamps a value to the hard cap. The interpreter throws an error
with code `LIMIT_EXCEEDED` when a run breaks one.

### A worked example

Walk every page of a transactions table. For every row, read the row, open its
receipt in a new page, and capture that receipt as a PNG and a PDF.

```json
{
  "version": 2,
  "steps": [
    { "op": "goto" },
    { "op": "waitFor", "selector": "table tbody tr" },
    {
      "op": "paginate",
      "nextSelector": "a.next",
      "maxPages": 5,
      "steps": [
        {
          "op": "extract",
          "name": "rows",
          "rowSelector": "table tbody tr",
          "fields": [
            { "name": "date", "selector": "td.date" },
            { "name": "amount", "selector": "td.amount" },
            { "name": "receipt", "selector": "td.receipt-no" }
          ],
          "emit": ["JSON", "CSV"]
        },
        {
          "op": "forEach",
          "rowSelector": "table tbody tr",
          "steps": [
            {
              "op": "extract",
              "name": "row",
              "fields": [{ "name": "receipt", "selector": "td.receipt-no" }]
            },
            {
              "op": "openLink",
              "selector": "a.receipt",
              "steps": [
                {
                  "op": "capture",
                  "as": ["PNG", "PDF"],
                  "name": "receipt-p{{page}}-r{{index}}-{{row.receipt}}"
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

Against a two-page table of three rows each, that definition produces
`receipt-p1-r0-8dx6t13140.png`, its PDF, four more pairs, `rows.json`,
`rows.csv`, and `row.json`.

To see it run against a fixture site that the script serves itself:

```bash
npm run typecheck
node scripts/manual/phase-2-interpreter.mjs
```

Run `npx playwright install chromium` first when Chromium is missing.

### The v1 config

A definition that carries no `version` is a v1 config. `POST /definitions`
upgrades it on write, so a stored config is always v2. The mapping is:

```
v1 { waitFor, rowSelector, fields, artifacts }
 -> [ goto, waitFor?, extract(name: 'rows'), capture(name: 'page')? ]
```

`JSON` and `CSV` in the v1 `artifacts` list serialize the extracted rows, so
they become `extract.emit`. `PNG` and `HTML` become a capture. `WEBM` becomes
`record: true`. An upgraded config keeps the v1 filenames: `data.json`,
`data.csv`, `screenshot.png`, `source.html`, and `recording.webm`.

## End-to-end walkthrough

1. Open http://localhost:3000 → **New definition**. Give it a name, a reachable
   URL (e.g. `https://example.com`), a row selector / field selectors, and check
   the **JSON**, **CSV**, and **PNG** artifacts. Create it. The form still posts
   a v1 config; the API upgrades it to a v2 step program on write. Phase 7 adds
   a step editor.
2. On the definition page click **Run**. Open the run from **Run history**: it
   transitions `QUEUED → RUNNING → SUCCEEDED` with an attempt recorded. The run
   page shows a live indicator and refreshes itself every 2 seconds until the
   run reaches a terminal status. No browser reload is needed.
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

To check the sweeper, the scheduler claim, and the catch-up policies against a
real database:

```bash
npm run build
npm run migrate
node scripts/manual/phase-3-stale.mjs "$DATABASE_URL"
node scripts/manual/phase-3-scheduler.mjs "$DATABASE_URL"
```

Both scripts remove every row that they write.

## API

| Route | Purpose |
| --- | --- |
| `GET /health` | Liveness probe |
| `GET /definitions` | List every definition |
| `POST /definitions` | Create a definition (`name`, `url`, `config`) |
| `GET /schedules` | List schedules, optionally `?definitionId=` |
| `POST /schedules` | Create a schedule (`definitionId`, `cron`, `timezone`, `enabled`) |
| `PATCH /schedules/:id` | Enable or disable a schedule (`enabled`) |
| `GET /runs` | List runs, optionally `?definitionId=` |
| `GET /runs/:id` | Read one run with its attempts and artifacts |
| `POST /runs` | Trigger a run |
| `GET /runs/:runId/artifacts` | List the artifacts of a run |
| `GET /artifacts/:id/download` | Download one artifact |

### `POST /runs`

```json
{ "definitionId": "<uuid>", "trigger": "API" }
```

`definitionId` is required. `trigger` is optional. The accepted values are
`MANUAL` and `API`, and the default is `MANUAL`. Any other value answers 400.
The scheduler writes the third trigger, `SCHEDULE`, so the API rejects it.

The response is the new run with status `QUEUED`.

### Browser access

The API answers a cross-origin request only when the `Origin` header matches
`CORS_ORIGINS`. The web UI posts from the browser, so `CORS_ORIGINS` must list
the URL the UI is served from. The default is `http://localhost:3000`. Use a
comma to give more than one origin.

## Observability

Every service logs structured JSON through `pino`. Set `LOG_LEVEL` to change the
level. Output is pretty-printed unless `NODE_ENV=production`.

- **Request ids.** The api tags each request with an id, returns it in the
  `X-Request-Id` response header, and logs the method, the path, the status and
  the duration. A caller that sends its own `X-Request-Id` keeps that value.
- **Run correlation.** Worker log lines for a job carry `runId`, `attemptId` and
  `definitionId`, so one failed run maps to its own lines.
- **Health.** The api, the worker and the scheduler each answer `GET /health`.
  The worker body also reports its id and the number of active jobs.
- **Failure diagnostics.** When a scrape fails, the worker stores what the page
  looked like at the point of failure as artifacts of the failed run:
  `failure-screenshot.png`, `failure-source.html` and `failure-console.json`.
  Open the failed run in the UI and download them. A capture that fails never
  changes the original error.

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
| `CORS_ORIGINS` | Comma separated browser origins the API accepts (default `http://localhost:3000`) |
| `WORKER_HEALTH_PORT` | Port of the worker `/health` server (default `4001`) |
| `SCHEDULER_HEALTH_PORT` | Port of the scheduler `/health` server (default `4002`) |
| `LOG_LEVEL` | Log level for every service: `trace`, `debug`, `info`, `warn`, `error`, `fatal` or `silent` (default `info`) |
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
