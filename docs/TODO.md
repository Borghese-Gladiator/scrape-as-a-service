# TODO — Gaps in the Scrape-as-a-Service platform

Status of this document: written 2026-09-07 against commit `9b36624` (the MVP).
It records what the platform cannot do today, and what is broken today. It is a
backlog, not a plan. Each item states the problem, the evidence in the code, and
the impact.

Priority key:
- **P0** — broken now, or blocks a stated use case.
- **P1** — the platform is unsafe or unreliable in normal use.
- **P2** — quality, cost, and developer experience.

---

## 0. Driving use case

The use case that exposed most of these gaps:

> Open an authenticated transactions table (CourtReserve). Walk every row on
> every page. Click the **Receipt** button on each row. The button opens the
> receipt in a new tab. Screenshot that receipt page. Save each screenshot to a
> folder.

The platform cannot do any part of this except the screenshot primitive. Items
1.1 through 1.7 are the blocking gaps.

---

## 1. Scrape capability

The scraper is a single declarative pass: navigate, wait for one selector, read
CSS selectors, capture the entry page. See `apps/worker/src/scrape.ts` and
`packages/shared/src/scrape-config.ts`.

### 1.1 No session, cookies, or credentials — P0
`runScrape` calls `browser.newContext()` with an empty state
(`apps/worker/src/scrape.ts:26`). There is no way to supply cookies, a Playwright
`storageState`, HTTP basic auth, a bearer header, or a login step. Every
authenticated site is out of reach.

Options to add, in increasing order of effort:
- A `storageState` JSON blob stored on the definition (encrypted at rest).
- A `connectOverCDP` mode that attaches to a Chrome the user already runs, so it
  reuses live cookies. Useful for local one-off jobs; not usable in Docker.
- A declarative `login` step (navigate, fill, submit, wait) with a secret store.

### 1.2 No actions — P0

**DONE (phase 2)** — The `Step` union, the validator, and the interpreter replace the single pass.
`ScrapeConfig` has no concept of an ordered step. It cannot click, type, select,
scroll, hover, press a key, or wait for navigation. Extraction is read-only.

Proposed shape: an ordered `steps` array with a closed set of verbs
(`click`, `fill`, `select`, `press`, `scroll`, `waitFor`, `screenshot`,
`goBack`, `forEach`). Keep the no-arbitrary-JS rule that
`validateScrapeConfig` enforces today.

### 1.3 No pagination — P0

**DONE (phase 2)** — The `paginate` verb walks the pager and stops on a disabled, missing, or unchanged next control.
The scraper loads one URL, one time. The driving use case has 2 pages; other
tables have hundreds. There is no next-page selector, no page limit, no
"until the next button is disabled" loop.

### 1.4 No new tab or popup handling — P0

**DONE (phase 2)** — `click` with `opens: 'newTab'` waits on the context `page` event; `goBack` closes the tab.
Nothing listens for `context.on('page')` or `page.waitForEvent('popup')`. A
button that opens a new tab is invisible to the scraper.

Note: where the control is a real link, reading its `href` and visiting the URL
directly is more reliable than tab handling. The config should support both.

### 1.5 No sub-page traversal — P0

**DONE (phase 2)** — `openLink` reads the link target, opens it in a new page, runs nested steps, then closes it.
There is no way to say "for each row, follow this link, capture the page that
opens, then come back". `extractRows` reads fields inside a row scope and stops
(`apps/worker/src/scrape.ts:64`). This is the core of the driving use case.

### 1.6 One screenshot per run, of the entry page only — P0

**DONE (phase 2)** — The `capture` verb takes a name template, and `PDF` is now an artifact type.
`buildArtifacts` emits exactly one `screenshot.png`
(`apps/worker/src/artifacts.ts:63`). There is no per-row, per-element, or
per-sub-page capture, and no naming scheme for a set of N images. The artifact
table stores one row per artifact, so N images is representable in the schema,
but nothing produces them.

Related: there is no `PDF` artifact type. For receipts a PDF is often the better
output than a PNG.

### 1.7 No local folder output — P0

**DONE (phase 5)** — Three answers. `npm run run-local` runs a definition with
no stack at all and writes every artifact straight into a folder.
`GET /runs/:id/artifacts.zip` streams the whole run as one archive.
`npm run export -- --run <id> --out ./folder` unpacks that archive to disk.
Artifacts go to MinIO and come back one at a time through
`GET /artifacts/:id/download`. There is no bulk export, no ZIP of a run, and no
"write to this host directory" mode. Retrieving 50 receipts means 50 clicks.

### 1.8 Extraction is text-and-attribute only — P2

**DONE (phase 2)** — Partly closed: `extract` now runs at any point and in any scope, and it accumulates across loops. Field-level normalization stays open.
`readField` returns `textContent` or one attribute
(`apps/worker/src/scrape.ts:70`). It cannot read a JSON blob out of a
`<script>` tag, follow a shadow root, read a table by column index, or
normalize whitespace, dates, or currency. Every consumer post-processes by hand.

### 1.9 No per-field robustness — P2
A missing selector silently yields `null`. There is no `required` flag, no
`default`, and no way to fail a run when the page structure changed. A site
redesign produces a run full of nulls that reports `SUCCEEDED`.

---

## 2. Correctness and reliability

### 2.1 The browser POST from the UI fails: no CORS on the API — P0
This is broken right now. `apps/web/src/app/definitions/new/page.tsx` is a client
component. It calls `getApiClient().createDefinition(...)` in the browser, which
`fetch`es `http://localhost:4000/definitions` with
`Content-Type: application/json`. That is a cross-origin, preflighted request
(port 3000 to port 4000). `apps/api/src/server.ts` registers no CORS middleware,
so the preflight gets no `Access-Control-Allow-Origin` and the browser blocks the
request.

The same applies to the **Run** button (`POST /runs`) and the schedule enable
toggle (`PATCH /schedules/:id`). The README walkthrough cannot succeed as
written.

Fix: add `cors` to the API with an allowlist from an env var, or proxy the API
through a Next.js route handler so the request is same-origin.

### 2.2 A run can stay RUNNING forever — P1
`processRun` sets the run to RUNNING, and only `finalizeFailure` or the success
path move it out. If the worker process dies mid-job, or the container is
killed, nothing writes a terminal status. There is no reaper, no lease, and no
heartbeat. The run and its attempt stay RUNNING permanently.

Fix: record a heartbeat on the attempt, and add a sweeper that fails runs whose
attempt has not beaten within N minutes.

### 2.3 No graceful shutdown — P1
Neither `apps/worker/src/index.ts` nor `apps/scheduler/src/index.ts` handles
`SIGTERM`. `docker compose down` or a rescale kills in-flight work, which
produces the stuck RUNNING state in 2.2. Postgres pools, the Redis connection,
and the browser are never closed.

### 2.4 The scheduler is not safe to run more than once — P1
`pollOnce` reads due schedules, then creates a run, then advances `next_run_at`
(`apps/scheduler/src/poll.ts:19`). There is no row lock and no transaction. Two
scheduler replicas both see the same due schedule and both create a run.
`enqueueRun` uses `jobId: runId`, so BullMQ deduplicates the *job*, but the two
runs are separate rows with separate ids, so both are enqueued.

Fix: `SELECT ... FOR UPDATE SKIP LOCKED`, or claim the schedule with a
conditional `UPDATE ... WHERE next_run_at <= now()` that returns the claimed row.

### 2.5 Missed schedules are dropped silently — P1
`computeNextRun(cron, tz, now)` computes the next fire time from *now*, not from
`last_run_at` (`apps/scheduler/src/poll.ts:24`). If the scheduler is down for a
day, every window in that day is skipped with no record. There is no catch-up
policy and no misfire log.

### 2.6 Repository functions lie about missing rows — P1
`createRun`, `updateRunStatus`, `setScheduleEnabled`, and `advanceSchedule` all
end with `return rows[0]!`. When the id does not exist, the value is `undefined`
at runtime but typed as non-null. `apps/api/src/routes/schedules.ts` happens to
check for a falsy value, so that path works, but the type is wrong and the next
caller will hit a `TypeError` on a property read.

Fix: return `T | null` and let callers handle it, or throw a typed
`NotFoundError` in the repository.

### 2.7 `started_at` is overwritten by every retry — P2
`updateRunStatus` sets `started_at` whenever the status is RUNNING
(`packages/db/src/repositories/runs.ts:28`). Each retry calls it again, so the
run's start time is the start of the *last* attempt, not the first. Total run
duration is therefore wrong whenever a retry happened.

Fix: `started_at = COALESCE(started_at, $3)`.

### 2.8 No per-run timeout — P1
Only `page.goto` has Playwright's default 30-second cap. A scrape over many rows,
or a page that never settles, has no overall limit. The job holds a worker slot
until BullMQ's stall detection fires 30 seconds later, and stall recovery can
then run the same job twice.

### 2.9 One Chromium process per job — P2
`launchBrowser: () => chromium.launch()` starts a full browser for every job
(`apps/worker/src/index.ts:31`). At `WORKER_CONCURRENCY=4` that is four Chromium
processes launched and torn down per batch. Launch cost dominates short scrapes.

Fix: launch one browser per worker process, and give each job its own context.
That is already the isolation boundary `runScrape` uses.

### 2.10 Artifacts are fully buffered in memory — P2
Every artifact is built as a `Buffer` and passed whole to `storage.put`
(`apps/worker/src/artifacts.ts:112`). A large HTML page, a WEBM recording, or a
run with many screenshots is held in RAM in full. `put` needs the byte length up
front, so streaming requires a different MinIO call.

---

## 3. Security

### 3.1 No authentication or authorization anywhere — P1
The API is fully open. Anyone who can reach port 4000 can list every definition,
create definitions, and trigger runs. There is no API key, no session, no user
model, and no tenancy. Combined with 3.2 this is the most serious gap.

### 3.2 Server-side request forgery through the definition URL — P1
`POST /definitions` accepts any `url` string
(`apps/api/src/routes/definitions.ts:24`) and the worker navigates to it with a
real browser. Nothing validates the scheme or the host. A caller can point a run
at `http://169.254.169.254/`, at `file://`, or at any service on the Docker
network, and read the response back out of the HTML artifact.

Fix: enforce `http`/`https`, resolve the host and reject private and
link-local ranges, and offer an allowlist.

### 3.3 Credentials will need a secret store — P1
Once 1.1 lands, cookies and passwords live in the definition. `config` is a
plain JSONB column and the API returns definitions in full. Secrets must be
stored separately, encrypted, and never returned by `GET /definitions`.

### 3.4 Artifact downloads are unauthenticated — P1
`GET /artifacts/:id/download` streams any artifact to any caller who knows the
UUID. `presignedGetUrl` exists on the storage client but is never used.

---

## 4. API and data model

### 4.1 No update or delete — P1

**DONE (phase 5)** — `PUT /definitions/:id`, `DELETE /definitions/:id` as a soft
delete through a new `deleted_at` column, and `DELETE /schedules/:id`. A
soft-deleted definition leaves the list, still answers `GET /definitions/:id`,
starts no new run, and makes its schedules stop firing.
Definitions and schedules can only be created and listed. There is no
`PUT /definitions/:id`, no `DELETE`, and no way to disable a definition. A typo
in a selector means creating a second definition and living with the first
forever.

### 4.2 No `GET /definitions/:id` — P2

**DONE (phase 5)** — The route exists, and `apps/web/src/lib/api.ts` calls it
instead of listing every definition.
The web client works around this by listing every definition and filtering in
memory (`apps/web/src/lib/api.ts:69`). This is O(all definitions) on every
definition page load.

### 4.3 No pagination, filtering, or limits — P1

**DONE (phase 5)** — `GET /runs` and `GET /definitions` take `?limit=` and
`?cursor=`, order by `created_at DESC, id DESC`, and return
`{ items, nextCursor }`. The limit defaults to 50 and clamps to 200.
`GET /runs` also takes `?status=`. A date filter stays open.
`listRuns` and `listDefinitions` return every row, ordered by `created_at DESC`,
with no `LIMIT`. Run history grows without bound; a busy definition will make
`GET /runs` return tens of thousands of rows. There is also no filter by status
or by date.

### 4.4 No run cancellation and no re-run — P2

**DONE (phase 5)** — `POST /runs/:id/cancel` removes the BullMQ job, marks the
run FAILED, and records the error code `CANCELLED` on an attempt.
`POST /runs/:id/rerun` creates a new run from the same definition. A cancel of a
RUNNING run does not interrupt the worker process; Phase 3 owns that.
A queued or running job cannot be stopped. A past run cannot be repeated without
going through the definition again.

### 4.5 No retention or cleanup — P1

**DONE (phase 5)** — `apps/scheduler/src/retention.ts` deletes runs older than
`RETENTION_DAYS` every hour. It removes the storage objects first and the rows
second, so a crash between the two leaves no orphan in MinIO. `RETENTION_DAYS=0`
disables the sweeper.
Nothing ever deletes artifacts from MinIO or rows from Postgres. Storage grows
monotonically. There is no TTL on artifacts and no archive policy.

### 4.6 `POST /runs/api-trigger` is undocumented and unused — P2
It exists in `apps/api/src/routes/runs.ts:63`. Its only difference from
`POST /runs` is the `trigger` enum value it records. It is absent from the
README and from the UI. Either document it or fold it into `POST /runs` with a
`trigger` field in the body.

### 4.7 No structured error taxonomy — P2
`errorCode` returns `err.name`, which for a plain `Error` is the literal string
`"Error"` (`apps/worker/src/process-run.ts:22`). Almost every failure is
therefore recorded as `Error` with a free-text message. There is no way to
count timeouts against selector misses against network failures.

---

## 5. Observability

### 5.1 Logging is `console.log` — P1
There is no structured logger, no log level, no request id, and no run id on
worker log lines. Correlating a failed run to its logs means guessing from
timestamps.

### 5.2 No health endpoint on worker or scheduler — P2
Only the API has `/health`. The compose file gives worker and scheduler no
healthcheck, so a crash-looping worker looks the same as a healthy one in
`docker compose ps`.

### 5.3 No metrics and no queue visibility — P2
Nothing reports queue depth, active jobs, failure rate, or run duration. There is
no Bull Board or equivalent. When runs stop appearing, there is no way to tell
whether the queue is backed up or the scheduler is dead.

### 5.4 The UI does not refresh — P2
Every page is `dynamic = 'force-dynamic'` server-rendered once. A QUEUED run
needs a manual browser reload to show progress. There is no polling, no
streaming, and no auto-refresh on the run detail page.

### 5.5 Run and attempt records carry no diagnostics — P2
When a run fails there is only an error string. There is no failure screenshot,
no captured HTML at the point of failure, no console log from the page, and no
network trace. Debugging a broken selector means reproducing it by hand.

---

## 6. Testing

### 6.1 No integration tests — P1
Every test uses a fake or a mock. `packages/db` tests run against a fake pg
client, so no SQL in the repository layer is ever executed. A syntax error or a
column typo in any query passes the whole suite. Nothing runs against real
Postgres, Redis, or MinIO.

Fix: add a `--runintegration` style suite with testcontainers or a compose
fixture, and run every repository query against a real database.

### 6.2 No end-to-end test — P1
Nothing exercises create-definition to artifact-download through the running
stack. The CORS failure in 2.1 is exactly the class of bug an end-to-end test
catches and unit tests cannot.

### 6.3 Untested modules — P2

**DONE (phase 2)** — the `toCsv` and `runScrape` parts. `toCsv` has direct
tests. The interpreter that `runScrape` drives has one test per verb against a
fake Playwright page, plus the composite and limit cases.
`validateScrapeConfig` has its own test file. The `schedules` and `artifacts`
routers still have no test.

`runScrape` (`apps/worker/src/scrape.ts`) has no test at all. `toCsv` has no
direct test, despite hand-rolled quoting and escaping. `validateScrapeConfig` is
covered only indirectly through an API route test. `apps/api` route tests cover
2 of the 4 routers: `schedules` and `artifacts` have none.

### 6.4 No CI — P1
There is no `.github/workflows` directory and no pipeline configuration of any
kind. Nothing runs typecheck, lint, or tests on a push.

---

## 7. Build, ops, and developer experience

### 7.1 No lint or format at the root — P2
Only `apps/web` has an eslint config. `packages/*` and the other two apps are
unlinted. There is no Prettier config, so formatting is by convention only. The
root `package.json` has no `lint` or `format` script.

### 7.2 `NEXT_PUBLIC_API_BASE_URL` is baked at build time — P2
Changing the API port requires a rebuild of the web image. The README documents
this, but it is a persistent sharp edge. A runtime-configured base URL, fetched
from a `/config` endpoint or read by a route handler proxy, removes it. Fixing
2.1 with a Next.js proxy removes this problem as a side effect.

### 7.3 The worker image is not pruned — P2
`apps/worker/Dockerfile` is single-stage on the Playwright base image. It keeps
dev dependencies, TypeScript, and all source. The API and scheduler Dockerfiles
should be checked for the same.

### 7.4 `cron-parser` v4 is deprecated — P2
`npm ci` warns: "v4 is no longer maintained, upgrade to v5". Only
`packages/shared/src/cron.ts` uses it, and it has test coverage, so the upgrade
is cheap.

### 7.5 Playwright browsers are a hidden local prerequisite — P2
Running the worker outside Docker requires `npx playwright install chromium`.
The README does not say so.

---

## Suggested order

1. **Unblock the UI**: 2.1 (CORS or a Next.js proxy).
2. **Make the driving use case possible**: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7.
3. **Stop losing runs**: 2.2, 2.3, 2.8.
4. **Close the open door**: 3.1, 3.2.
5. **Prove it works**: 6.1, 6.2, 6.4.
6. Everything else.
