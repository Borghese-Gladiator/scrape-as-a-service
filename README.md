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

## Scrape definitions (config v2)

A scrape definition is data, never code. The platform never evaluates
JavaScript that a user supplies. Every capability is a step verb with a closed
schema, and `validateScrapeConfig` checks that schema before the API stores the
definition.

```ts
interface ScrapeConfig {
  version: 2;
  auth?: AuthConfig;   // see Security below
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

## Delivery: get the files out

### The local runner — no stack at all

```bash
npm run run-local -- --definition ./my-definition.json --out ./receipts
```

The local runner reads a definition from disk, launches a browser, runs the step
program, and writes every artifact into the folder. It needs no Postgres, no
Redis, and no MinIO. This is the mode to use when the target site is only
reachable from your own machine, which a Docker worker cannot do.

| Flag | Purpose |
| --- | --- |
| `--definition` | The JSON file. Either `{ name?, url, config }` or a bare config. |
| `--out` | The output folder. The runner creates it when it is missing. |
| `--url` | Override the URL that the definition carries. |
| `--headed` | Show the browser. The default is headless. |
| `--timeout` | Override `limits.maxDurationMs`, in milliseconds. |
| `--allow-private` | Let the run reach a loopback or a private URL. A local fixture site needs it. |
| `--allow-cdp` | Let `auth.mode=cdp` attach to a Chrome that already runs. |
| `--allow-profile` | Let `auth.mode=chromeProfile` copy a Chrome profile. |

The runner prints one line per artifact and a count. It exits 1 on a failure and
prints the error code first, for example `error BAD_CONFIG: steps must be a
non-empty array`.

### Bulk export from a run

```bash
# every artifact of one run, as a streaming archive
curl -OJ http://localhost:4000/runs/<run-id>/artifacts.zip

# the same thing, unpacked into a folder
npm run export -- --run <run-id> --out ./receipts
```

`GET /runs/:id/artifacts.zip` opens one object at a time and writes it straight
to the response, so a run of hundreds of screenshots never sits in memory. Each
entry takes the artifact `name` that the step program produced. The run detail
page carries a **Download all as ZIP** link for the same route.

The export CLI reads `--api`, then `API_BASE_URL`, then
`http://localhost:4000`.

## The CourtReserve receipts job

The job that the whole platform exists to serve: retrieve your own payment
receipts from CourtReserve, as a PNG and a PDF for each one.

```bash
# 1. Find out what the page really looks like, in your own logged-in session.
npm run discover -- --url "<the balance page>" --cdp http://localhost:9222

# 2. Put the selectors it names into definitions/courtreserve-receipts.json.

# 3. Run the job.
npm run job:receipts -- --out ./exports/receipts
```

**Read [docs/RECEIPTS.md](RECEIPTS.md) before the first run.** It gives the
exact steps, including how to start Chrome so that `--cdp` works. Two points
matter most:

- Every selector in the shipped definition is an **unverified Kendo UI 2022.1
  default**. The page is behind a login, so nobody has seen its markup. The
  discovery CLI confirms each one against your session.
- Quit Chrome **completely** before you start it with
  `--remote-debugging-port=9222`. A flag passed while Chrome already runs opens
  a window in the existing process and does not open the port. `--profile` is
  the alternative that needs no restart.

Two definition files ship, because the Receipt control may be an anchor or a
JavaScript handler. The discovery report names which to use.

| File | Receipt step |
| --- | --- |
| `definitions/courtreserve-receipts.json` | `openLink` on the control's `href`. The default. |
| `definitions/courtreserve-receipts-newtab.json` | `click` with `opens: newTab`, then `capture`, then `goBack`. |

To prove the plumbing without the live site, run the manual script. It serves a
fixture with the same Kendo markup, runs the shipped definition against it, and
checks every file it produces. It needs only Chromium:

```bash
node scripts/manual/phase-9-courtreserve-fixture.mjs
```

### The discovery CLI

```bash
npm run discover -- --url <url> [--cdp http://localhost:9222] [--profile] [--out report.json]
```

It opens a page in a browser session that you already logged into and reports
the selectors a definition needs: every grid with its headers and row count,
every control in the first data row with its `href` and `target`, every pager
control with its disabled state, every tab strip, and every date input. It ends
with a suggested `rowSelector`, `nextSelector` and receipt-control selector,
each with the evidence behind it. It prints the report and writes it as JSON.

It changes nothing on the page.

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

## The API

| Route | Purpose |
| --- | --- |
| `GET /definitions` | One page of definitions. A soft-deleted one never appears. |
| `GET /definitions/:id` | One definition. A soft-deleted one still answers. |
| `POST /definitions` | Create. It accepts a v1 or a v2 config and stores v2. |
| `PUT /definitions/:id` | Update `name`, `url`, or `config`. Each is optional. |
| `DELETE /definitions/:id` | Soft delete. The runs and artifacts stay readable. |
| `GET /schedules` · `POST /schedules` · `PATCH /schedules/:id` | List, create, enable. |
| `DELETE /schedules/:id` | Remove a schedule. |
| `GET /runs` | One page of runs. It takes `?definitionId=` and `?status=`. |
| `GET /runs/:id` | The run, its attempts, and its artifacts. |
| `POST /runs` | Trigger a run. |
| `POST /runs/:id/cancel` | Cancel a QUEUED or RUNNING run. |
| `POST /runs/:id/rerun` | Start a new run from the same definition. |
| `GET /runs/:id/artifacts` | The artifact rows of a run. |
| `GET /runs/:id/artifacts.zip` | Every artifact of a run, as a streaming archive. |
| `GET /artifacts/:id/download` | One artifact. |

### Pagination

`GET /runs` and `GET /definitions` return a page, not a bare array:

```json
{ "items": [ ... ], "nextCursor": "MjAyNi0wMS0wMV..." }
```

Pass `?limit=` (default 50, maximum 200) and `?cursor=`. The order is
`created_at DESC, id DESC`, so a row that arrives during a walk never makes an
earlier row repeat. `nextCursor` is `null` on the last page. An unreadable
cursor starts again at page one.

### Cancel

A cancel marks the run `FAILED` and writes the error code `CANCELLED` on an
attempt. The run status enum keeps its four values, because the error code
already carries the reason. A QUEUED run also loses its BullMQ job. A RUNNING
run keeps its worker process: the job is already locked, so the worker stops at
its next write.

### Retention

The scheduler deletes runs older than `RETENTION_DAYS` (default 30) once an
hour. It removes the storage objects first and the rows second, so a failure
between the two leaves a row for the next sweep instead of an orphan object in
MinIO. Set `RETENTION_DAYS=0` to keep everything.

## Security

### The API key

Every route except `/health` needs the `X-API-Key` header. The value comes from
`API_KEY`.

```bash
curl -H "X-API-Key: $API_KEY" http://localhost:4000/definitions
curl http://localhost:4000/health          # no key needed
```

When `API_KEY` is empty the API runs open and prints a warning on boot. With
`NODE_ENV=production` an empty `API_KEY` stops the API from starting. The
comparison is timing safe.

**How the browser gets a key.** A server-rendered page reads the server-only
`API_KEY`, which never reaches the bundle. A client component runs in the
browser and cannot read it, so it falls back to `NEXT_PUBLIC_API_KEY`. Next.js
inlines that value at build time, so **anybody who loads the page can read it**.
Treat it as a shared local-development key, never as a production credential.
The real fix is a Next.js route handler that proxies the API so the browser
never holds a key; that is TODO 7.2 and it is not in this phase.

### The secret store

A secret holds a credential that a scrape needs: a Playwright `storageState`
blob, or a password that `fill.valueFrom` names.

```bash
curl -X POST http://localhost:4000/secrets \
  -H "X-API-Key: $API_KEY" -H 'Content-Type: application/json' \
  -d '{"name":"court_session","value":"{\"cookies\":[]}"}'

curl -H "X-API-Key: $API_KEY" http://localhost:4000/secrets
curl -X DELETE -H "X-API-Key: $API_KEY" http://localhost:4000/secrets/<id>
```

`POST /secrets` encrypts the value with AES-256-GCM under
`SECRET_ENCRYPTION_KEY` and stores the ciphertext. **The API never returns a
plaintext secret and never returns a ciphertext.** `GET /secrets` returns names
and timestamps only. `GET /definitions` returns the config, which holds a secret
*name*, never a value. Only the worker decrypts, and it decrypts one run's
secrets one time.

`SECRET_ENCRYPTION_KEY` must decode to exactly 32 bytes from base64 or from hex.
A wrong length fails loudly on the first use. Generate one with
`openssl rand -base64 32`. Lose it and every stored secret is unreadable; there
is no recovery.

### The four auth modes

```ts
type AuthConfig =
  | { mode: 'none' }
  | { mode: 'storageState'; secretRef: string }
  | { mode: 'cdp'; endpointUrl: string }
  | { mode: 'chromeProfile'; userDataDir: string; profileDirectory?: string }
  | { mode: 'login'; secretRef?: string; steps: Step[] };
```

| Mode | Where it runs | What it does |
| --- | --- | --- |
| `none` | anywhere | A fresh, empty context. This is the default. |
| `storageState` | anywhere | Reads the named secret, parses it as a Playwright `storageState` blob, and passes it to `browser.newContext`. **This is the production path.** |
| `cdp` | local worker | Attaches to a Chrome that the user already runs, so the user's live cookies apply. |
| `chromeProfile` | local worker | Copies the user's Chrome profile and launches a persistent context on the copy. **The most reliable path for a one-off job on the user's own machine.** |
| `login` | anywhere | Replays declarative steps to obtain a session, then saves it to the named secret for reuse. |

A secret that a config names but the store does not hold fails the run with
`AUTH_FAILED`.

**`cdp`.** Start Chrome with a debug port, then point the definition at it:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222
```

```json
{ "mode": "cdp", "endpointUrl": "http://127.0.0.1:9222" }
```

It needs `ALLOW_CDP=true` on the worker. The worker reuses the first context the
browser already has, so the user's session applies. It never closes a browser it
did not launch: it closes only the pages the run opened.

**This mode cannot work from inside the Docker worker.** `127.0.0.1` in the
container is the container, not the host, and `host.docker.internal` still needs
Chrome to listen on every interface, which exposes a full debug port on the
network. Run the worker on the host instead:

```bash
ALLOW_CDP=true npm run dev --workspace @scraper/worker
```

**`chromeProfile`.** Chrome holds an exclusive lock on a live profile, so the
worker copies the named profile to a temporary directory first, launches a
persistent context on the copy, and deletes the copy afterwards. The copy skips
the cache directories, which are large and useless to a session.

```json
{
  "mode": "chromeProfile",
  "userDataDir": "/Users/you/Library/Application Support/Google/Chrome",
  "profileDirectory": "Default"
}
```

It needs `ALLOW_LOCAL_PROFILE=true`, a separate flag from `ALLOW_CDP` because
reading the profile off the disk is a larger grant than attaching to a debug
port the user already opened. It needs a real Chrome (`channel: 'chrome'`), not
the bundled Chromium, and it needs the host filesystem, so it is a local-worker
mode as well.

**`login`.** The steps are ordinary step verbs, so a password comes from the
secret store through `fill.valueFrom`:

```json
{
  "mode": "login",
  "secretRef": "court_session",
  "steps": [
    { "op": "goto", "url": "https://app.example.com/login" },
    { "op": "fill", "selector": "#user", "valueFrom": "court_user" },
    { "op": "fill", "selector": "#pw", "valueFrom": "court_pw" },
    { "op": "click", "selector": "button[type=submit]" },
    { "op": "waitFor", "selector": "#dashboard" }
  ]
}
```

After the steps run, the worker writes `context.storageState()` back to
`secretRef`. The next run reuses that stored session and skips the login steps,
as long as the session still holds one cookie that has not expired. A session
cookie does not count, because it dies with the browser that created it.

### The URL guard

`assertSafeUrl` allows `http` and `https` only. It resolves the host and rejects
every address that is not globally routable: loopback, `10/8`, `172.16/12`,
`192.168/16`, `169.254/16`, `100.64/10`, multicast, reserved, and the IPv6
equivalents `::1`, `fe80::/10`, `fc00::/7` and `ff00::/8`. An IPv4-mapped IPv6
address is judged as the IPv4 address it carries.

The guard runs in two places:

- `POST /definitions`, on the definition URL. A rejected URL returns 400.
- The worker, on every `goto` and `openLink` target, and again on the URL the
  page landed on. The second check matters because a public name can resolve to
  a private address later, and because a redirect can end on a different host.

`ALLOW_PRIVATE_URLS=true` turns the address check off. The scheme check stays on
in every case. Set it only to scrape a local fixture site.

### Artifact downloads

`GET /artifacts/:id/download` streams the object and sits behind the API key
like every other route. A browser cannot put a header on an `<a href>`, so the
run detail page calls `GET /artifacts/:id/url` server side and renders the
short-lived presigned URL that MinIO returns. That URL expires in 15 minutes.

The presigned URL points at MinIO directly, so `MINIO_ENDPOINT` must be a host
the browser can reach. In the compose stack the API talks to `minio` over the
Docker network, which the browser cannot resolve; the page falls back to the
streaming URL there.

### Manual check

```bash
API_BASE_URL=http://localhost:4000 API_KEY=... node scripts/manual/phase-4-auth.mjs
```

It proves that an unauthenticated request gets 401, that `/health` gets 200,
that a secret round-trips without the value ever appearing in a response, and
that the guard rejects a definition pointed at `http://169.254.169.254/`. It
deletes every row it creates.

## End-to-end walkthrough

1. Open http://localhost:3000 → **New definition**. Give it a name, a reachable
   URL (e.g. `https://example.com`), a row selector / field selectors, and check
   the **JSON**, **CSV**, and **PNG** artifacts. Create it. The form still posts
   a v1 config; the API upgrades it to a v2 step program on write. Phase 7 adds
   a step editor.
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
6. **Export:** on a `SUCCEEDED` run, click **Download all as ZIP**, or run
   `npm run export -- --run <run-id> --out ./receipts`.

To prove the delivery path against a fixture site, run the manual script. Part
one needs only Chromium. Part two needs Postgres and MinIO, and it deletes every
row and object that it creates:

```bash
npm run build
node scripts/manual/phase-5-export.mjs
```

To prove the CourtReserve job against a Kendo-shaped fixture, with no stack and
no live session:

```bash
node scripts/manual/phase-9-courtreserve-fixture.mjs
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
| `RETENTION_DAYS` | Delete runs older than this many days. 0 disables the sweeper (default 30) |
| `API_KEY` | The value that `X-API-Key` must match. Empty runs the API open, except in production, where the API refuses to start |
| `SECRET_ENCRYPTION_KEY` | 32 bytes as base64 or hex. It encrypts every stored secret |
| `ALLOW_PRIVATE_URLS` | `true` lets the platform fetch a loopback, private or link-local URL |
| `ALLOW_CDP` | `true` lets `auth.mode=cdp` attach to a running Chrome. Local worker only |
| `ALLOW_LOCAL_PROFILE` | `true` lets `auth.mode=chromeProfile` copy a Chrome profile. Local worker only |
| `NEXT_PUBLIC_API_BASE_URL` | Base URL the web frontend uses to reach the `api` service (falls back to `API_BASE_URL`, then `http://localhost:4000`) |
| `NEXT_PUBLIC_API_KEY` | The API key for browser calls. It is baked into the bundle and is therefore public |

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
