# Implementation prompt — Scrape-as-a-Service v2

This document is a self-contained brief. Give it to a fresh agent session, or
follow it yourself. It states what to read, what to build, in what order, and
how to prove each part works.

Written 2026-09-09 against commit `49618b4`.

---

## 0. How to use this document

1. Read Section 2 in full before you write any code. Do not skip it. The design
   in Section 4 only makes sense after you know the current shapes.
2. Read `docs/TODO.md`. This prompt implements it. The TODO document holds the
   evidence for every claim here; this document holds the plan.
3. Work one phase at a time. Each phase in Section 5 is a separate commit and a
   separate PR. Do not start a phase until the previous phase is green.
4. Section 8 lists the questions that need a human answer. Ask them early. Do
   not block the whole task on them — do everything that does not depend on an
   answer first.

---

## 1. Mission

Turn a single-pass, read-only, anonymous scraper into an authenticated,
multi-step, paginated browser automation platform, without giving up the
property that makes the current design safe: **a scrape definition is data, not
code. The platform never evaluates arbitrary JavaScript supplied by a user.**

The proof that the mission succeeded is one concrete job, described in
Section 3, expressed entirely as a stored scrape definition.

Two rules constrain every decision:

- **Keep it declarative.** Every new capability is a new step verb with a closed
  schema, validated before storage. If a feature needs `page.evaluate(userCode)`,
  the feature is designed wrong. Find another shape.
- **Prefer the simplest thing that works.** Do not build a plugin system, a DSL
  compiler, or a dynamic step registry. A discriminated union and a `switch` is
  the right amount of structure.

---

## 2. What to read, in order

Read every file in this list. The parenthetical says why it matters.

### 2.1 Start here — the contract that changes most

| File | Why |
| --- | --- |
| `packages/shared/src/scrape-config.ts` | The whole data model of a scrape. `ScrapeConfig`, `ScrapeResult`, and `validateScrapeConfig`. Phase 2 rewrites this file. Note how validation rejects anything not in a closed set — preserve that property. |
| `apps/worker/src/scrape.ts` | The entire scrape engine, 103 lines. `runScrape` does goto, waitFor, extract, capture, in that fixed order. `extractRows` is the only extraction path. Phase 2 replaces this with a step interpreter. |
| `apps/worker/src/artifacts.ts` | How a `ScrapeResult` becomes stored objects. Note `buildArtifacts` hardcodes one filename per type (`data.json`, `screenshot.png`). That is why N screenshots is impossible today. |

### 2.2 The run lifecycle

| File | Why |
| --- | --- |
| `apps/worker/src/process-run.ts` | Attempt creation, status transitions, retry semantics. Read `finalizeFailure` closely: it marks the run FAILED only on the last BullMQ attempt, and always rethrows. Phases 3 and 6 change this file. |
| `apps/worker/src/index.ts` | Worker bootstrap. Note `launchBrowser: () => chromium.launch()` — one full browser per job. Note the absence of any `SIGTERM` handler. |
| `packages/db/src/repositories/runs.ts` | `updateRunStatus` holds the `started_at` bug (TODO 2.7). Every function ends `return rows[0]!`, which is a lie when no row matched (TODO 2.6). |
| `packages/db/src/repositories/attempts.ts` | How `attempt_number` increments. Phase 3 adds a heartbeat column here. |

### 2.3 Scheduling

| File | Why |
| --- | --- |
| `apps/scheduler/src/poll.ts` | 29 lines. Read, create, enqueue, advance — with no transaction and no lock. Phase 3 rewrites it. |
| `apps/scheduler/src/index.ts` | The interval loop. The `running` flag guards against overlap within one process, but not across processes. |
| `packages/db/src/repositories/schedules.ts` | `findDueSchedules` and `advanceSchedule` are the two halves of the race. |
| `packages/shared/src/cron.ts` | 13 lines. `computeNextRun` takes `from` and always computes forward from it, which is why missed windows vanish (TODO 2.5). |

### 2.4 The API surface

| File | Why |
| --- | --- |
| `apps/api/src/server.ts` | Route mounting. **Note what is absent: no CORS middleware and no auth middleware.** Phases 1 and 4 add both. |
| `apps/api/src/routes/definitions.ts` | Only GET-list and POST. No read-one, no update, no delete. The `url` field is stored with no validation at all (TODO 3.2). |
| `apps/api/src/routes/runs.ts` | Both trigger paths. `POST /runs/api-trigger` is dead weight (TODO 4.6). |
| `apps/api/src/routes/artifacts.ts` | The download stream. No auth, and the filename comes from the object key. |
| `apps/api/src/http.ts` | `asyncHandler` and `errorMiddleware`. Reuse both; do not invent a second error path. |

### 2.5 Storage, queue, and config

| File | Why |
| --- | --- |
| `packages/shared/src/storage.ts` | `runObjectKey(runId, filename)` builds `runs/<id>/<filename>`. Phase 2 needs collision-free names under that prefix. `presignedGetUrl` exists and is never called — Phase 4 may use it. |
| `packages/shared/src/queue.ts` | `defaultJobOptions` sets `attempts: 3` with exponential backoff. `finalizeFailure` reads `job.opts.attempts` to decide when to give up, so these two must stay consistent. |
| `packages/shared/src/config.ts` | The env contract. Every new setting goes here, with `required` or `optional`, and into `.env.example`. |

### 2.6 Database

| File | Why |
| --- | --- |
| `packages/db/migrations/0001_init.sql` | The only migration. Note the enums: `artifact_type` is a Postgres enum, so a new artifact type needs `ALTER TYPE`. Note `artifacts` has no name column. |
| `packages/db/src/migrate.ts` | The runner. It reads `migrations/*.sql`, sorted by filename, and records applied files in `schema_migrations`. Add files; never edit an applied one. |
| `packages/db/src/types.ts` | Row types. Keep these in sync with every migration. |

### 2.7 Frontend

| File | Why |
| --- | --- |
| `apps/web/src/lib/api.ts` | The typed client, and the dual base-URL logic for server-side versus browser requests. Read the comments — they explain the Docker networking constraint. `getDefinition` fetches the whole list and filters (TODO 4.2). |
| `apps/web/src/components/DefinitionForm.tsx` | The current editor. It builds a v1 config from flat inputs. Phase 7 must replace or extend it for step programs. |
| `apps/web/src/app/definitions/new/page.tsx` | Proof of the CORS bug: a `'use client'` component that POSTs from the browser to another origin. |
| `apps/web/src/app/runs/[id]/page.tsx` | Server-rendered once, `force-dynamic`, no polling. Phase 6 adds refresh. |

### 2.8 Operations

| File | Why |
| --- | --- |
| `docker-compose.yml` | Service graph, healthchecks, `depends_on` ordering. Worker and scheduler have no healthcheck. Read the `web` build arg comment about the baked-in public URL. |
| `apps/worker/Dockerfile` | Built on the Playwright base image, so browsers are present. Single stage, so dev dependencies ship. |
| `README.md` | The documented walkthrough. Update it in every phase that changes behavior. |

### 2.9 Tests — read these to learn the house style

| File | Why |
| --- | --- |
| `apps/worker/src/__tests__/process-run.test.ts` | How the worker is tested with mocked db, storage, and scrape. Follow this pattern. |
| `apps/scheduler/src/__tests__/poll.test.ts` | Fake clock and fake queue. |
| `packages/db/src/__tests__/status-transitions.test.ts` | **Important:** this uses a fake pg client, so no SQL is ever executed. This is why a SQL typo passes the suite (TODO 6.1). Phase 8 fixes this. |
| `apps/web/src/components/__tests__/RunDetail.test.tsx` | Testing-library style. Use `getByRole(role, { name })` first. |

---

## 3. The target use case

This is the acceptance test for the whole project.

**URL:** `https://app.courtreserve.com/Online/MyBalance/Index/13140?page=details`

**Site:** CourtReserve, a booking platform. The page is the user's own account
balance page for the LJB Badminton Club. The user owns this data. The job is to
retrieve their own payment receipts.

**Page structure, from screenshots:**

- A `Transaction(s)` heading, then two tabs: `Transaction Details` and `Packages`.
- Inside `Transaction Details`, five sub-tabs: `Unpaid`, `Paid`, `Payments`,
  `Adjustments`, `All`. The target is `Payments`.
- Two date inputs that bound the range. The screenshot shows `05/02/2026` to
  `07/31/2026`.
- A table with columns `Date`, `Amount`, `Paid Date`, `Payment Type`, and an
  unlabeled column that holds a blue **Receipt** button on every row.
- Pager controls below the table: `<`, `1`, `2`, `>`. The screenshot shows page 2
  active, so at least two pages exist.
- The **Receipt** button opens a receipt page in a new browser tab. That page
  shows a `Home` button, a `Print` button, and a receipt card with a receipt
  number (`Receipt: #8DX6T13140`), the member name and id, a line item, a total,
  a payment type, a timestamp, and who tendered it.

**The job:**

1. Reach the page with the user's existing session. The page is behind a login.
2. Select the `Payments` sub-tab.
3. Set the date range to cover the whole history the user wants.
4. For every row, on every page of the pager:
   a. Read the row fields (date, amount, paid date, payment type).
   b. Open that row's receipt.
   c. Capture the receipt page as an image, and as a PDF if possible.
   d. Return to the table.
5. Save every capture, named so the files sort and identify cleanly.
6. Deliver the whole set to a local folder in one action.

**What the implementer must NOT do:** do not guess the CSS selectors. They are
not in this document, and they are not knowable from a screenshot. The selectors
must be discovered against the live page. See Section 8, question 1.

**Design consequences that this job forces:**

| Requirement | Forces |
| --- | --- |
| Behind a login | An auth model (Phase 4) |
| Click a tab, set dates | Action steps (Phase 2) |
| Every page of the pager | A pagination step (Phase 2) |
| Per-row receipt | A `forEach` step with nested steps (Phase 2) |
| Opens a new tab | Popup handling, or read the link target (Phase 2) |
| One capture per row | Named, templated artifact names (Phase 2) |
| Save to a folder | Bulk export (Phase 5) |

---

## 4. Design

### 4.1 The step program

Replace the flat `ScrapeConfig` with an ordered program. This is the central
change. Everything else follows from it.

```ts
// packages/shared/src/scrape-config.ts

export interface ScrapeConfig {
  version: 2;
  auth?: AuthConfig;
  steps: Step[];
  limits?: Limits;
}

export interface Limits {
  maxDurationMs?: number;   // default 120_000, hard cap 900_000
  maxSteps?: number;        // default 500  — counts executed steps, loops included
  maxPages?: number;        // default 50   — navigations
  maxArtifacts?: number;    // default 200
}

export type Step =
  | { op: 'goto';     url?: string; waitUntil?: WaitUntil }
  | { op: 'waitFor';  selector: string; timeoutMs?: number; state?: 'visible' | 'attached' }
  | { op: 'click';    selector: string; opens?: 'same' | 'newTab' }
  | { op: 'fill';     selector: string; value?: string; valueFrom?: string }
  | { op: 'select';   selector: string; value: string }
  | { op: 'press';    key: string }
  | { op: 'scroll';   to: 'bottom' | 'element'; selector?: string }
  | { op: 'extract';  name: string; rowSelector?: string; fields: FieldSelector[] }
  | { op: 'capture';  as: CaptureType[]; name: string }
  | { op: 'forEach';  rowSelector: string; max?: number; steps: Step[] }
  | { op: 'openLink'; selector: string; attribute?: string; steps: Step[] }
  | { op: 'paginate'; nextSelector: string; maxPages: number; steps: Step[] }
  | { op: 'goBack' };
```

Notes on each decision:

- **`click` with `opens: 'newTab'`** waits on `context.waitForEvent('page')`,
  runs nothing, and makes the new page current until a `goBack`. Use it when the
  control is a JavaScript handler.
- **`openLink`** reads an attribute (default `href`) from the matched element,
  opens that URL in a fresh page, runs the nested `steps` there, then closes the
  page. This is more reliable than popup interception, so prefer it whenever the
  control is a real anchor. Support both, because the CourtReserve Receipt
  control may be either.
- **`forEach`** scopes the nested steps to the nth match of `rowSelector`. Every
  nested selector resolves inside that row. It binds two variables for name
  templates: `index` (zero-based, stable across pages) and the fields of the
  most recent `extract` in the same scope.
- **`paginate`** runs its nested steps, then clicks `nextSelector`, then repeats,
  and stops when the selector is missing, disabled, or `maxPages` is reached.
  It must detect a page that does not change and stop, to avoid an infinite loop.
- **`fill`** takes `value` for a literal, or `valueFrom` for a secret reference.
  Never both. A literal is for a date field; a secret reference is for a
  password.

**Name templates.** `capture.name` accepts `{{index}}` and `{{row.<field>}}`
only. No expressions, no functions. Resolve, then sanitize hard: lowercase,
replace every character outside `[a-z0-9._-]` with `-`, collapse runs of `-`,
truncate to 120 characters, and append the extension for the capture type. If
two artifacts in one run resolve to the same name, append `-2`, `-3`, and so on.
Never let a template produce `..`, a leading `/`, or an empty string.

**`CaptureType`** is `'PNG' | 'PDF' | 'HTML'`. Add `PDF` to the `artifact_type`
Postgres enum. `page.pdf()` works in Chromium headless only, so document that.

### 4.2 Backward compatibility

Existing definitions hold v1 config. Do not break them and do not force a
manual migration.

Write `upgradeScrapeConfig(input: unknown): ScrapeConfig`. When the input has no
`version`, treat it as v1 and map it:

```
v1 { waitFor, rowSelector, fields, artifacts }
  ->
v2 steps: [
     { op: 'goto' },
     ...(waitFor ? [{ op: 'waitFor', selector: waitFor }] : []),
     { op: 'extract', name: 'rows', rowSelector, fields },
     ...(captureTypes.length ? [{ op: 'capture', as: captureTypes, name: 'page' }] : []),
   ]
```

`JSON` and `CSV` in v1 `artifacts` are not captures — they are serializations of
the extracted rows. Keep that behavior: an `extract` step always emits a JSON
artifact, and emits a CSV artifact when the config asks for one. Decide where
that flag lives and write it down.

Accept both versions at `POST /definitions`. Upgrade on write, so the stored
config is always v2. Keep the two existing API route tests passing unchanged —
they are the regression guard for this mapping.

### 4.3 Authentication

```ts
export type AuthConfig =
  | { mode: 'none' }
  | { mode: 'storageState'; secretRef: string }
  | { mode: 'cdp'; endpointUrl: string }
  | { mode: 'login'; secretRef?: string; steps: Step[] };
```

- **`storageState`** is the production path. The secret holds a Playwright
  `storageState` JSON blob. Pass it to `browser.newContext({ storageState })`.
- **`cdp`** is the local path, and it is the fastest route to the CourtReserve
  job. The worker calls `chromium.connectOverCDP(endpointUrl)` and reuses a
  Chrome the user already has open and logged in. The user starts Chrome with
  `--remote-debugging-port=9222`. This does not work from inside the Docker
  worker without extra host networking, so gate it behind
  `ALLOW_CDP=true` and document it as a local-worker mode.
- **`login`** replays declarative steps to obtain a session, then saves the
  resulting `storageState` back to the secret for reuse.

**Secrets.** Add a `secrets` table: `id`, `name` (unique), `ciphertext`,
`created_at`, `updated_at`. Encrypt with AES-256-GCM using `node:crypto` and a
key from `SECRET_ENCRYPTION_KEY`. Store the IV and auth tag with the ciphertext.
The API exposes create, list-names, and delete. **It never returns a plaintext
secret, and `GET /definitions` never includes one.** Only the worker decrypts.

### 4.4 Everything else

These are the TODO items grouped by the phase that fixes them. The TODO document
holds the evidence and the file references; do not restate them, fix them.

- **CORS** (TODO 2.1): add the `cors` package to the API, with an origin
  allowlist from a `CORS_ORIGINS` env variable. Do not build a Next.js proxy —
  the proxy is a larger change that also solves TODO 7.2, but it adds a hop and
  complicates the artifact download stream. Choose the five-line fix.
- **Stuck runs** (TODO 2.2): add `heartbeat_at` to `scrape_run_attempts`. The
  worker updates it every 15 seconds during a run. A sweeper marks attempts
  stale after `STALE_ATTEMPT_MINUTES` and fails their runs.
- **Shutdown** (TODO 2.3): handle `SIGTERM` and `SIGINT` in the worker and the
  scheduler. Close the BullMQ worker, the browser, the pool, and Redis.
- **Scheduler race** (TODO 2.4): claim due schedules inside one transaction with
  `SELECT ... FOR UPDATE SKIP LOCKED`, and advance `next_run_at` in the same
  transaction.
- **Missed windows** (TODO 2.5): add a `catch_up` column with values `skip` and
  `runOnce`. Compute the next run from `last_run_at` when it exists.
- **Repository return types** (TODO 2.6): return `T | null`. Delete every
  `rows[0]!`.
- **`started_at`** (TODO 2.7): `started_at = COALESCE(started_at, $3)`.
- **Timeouts** (TODO 2.8): enforce `limits.maxDurationMs` in the interpreter.
- **Browser reuse** (TODO 2.9): launch one browser per worker process; one
  context per job.
- **Auth and SSRF** (TODO 3.1, 3.2): an `X-API-Key` check on every route except
  `/health`, and a URL guard that allows only `http` and `https` and rejects
  loopback, private, and link-local addresses after DNS resolution, unless
  `ALLOW_PRIVATE_URLS=true`.
- **API completeness** (TODO 4.1–4.4): read-one, update, soft delete; schedule
  delete; `?limit=` and `?cursor=` pagination; `?status=` filter; cancel; rerun.
- **Retention** (TODO 4.5): a sweeper that deletes runs and artifacts older than
  `RETENTION_DAYS`, objects first, then rows.
- **Errors** (TODO 4.7): a real error taxonomy — `TIMEOUT`, `SELECTOR_NOT_FOUND`,
  `NAVIGATION_FAILED`, `AUTH_FAILED`, `LIMIT_EXCEEDED`, `STORAGE_FAILED`,
  `UNKNOWN` — set at the throw site, not inferred from `err.name`.
- **Logging** (TODO 5.1): `pino`, with `runId`, `attemptId`, and `definitionId`
  bound to the child logger for the duration of a job.
- **Health** (TODO 5.2): a tiny `/health` server in the worker and the
  scheduler, plus compose healthchecks.
- **Failure diagnostics** (TODO 5.5): on any failure, capture a screenshot and
  the HTML, and store them as artifacts of the failed attempt. This single
  feature will save more debugging time than any other item in this list.
- **UI refresh** (TODO 5.4): poll the run detail page every 2 seconds while the
  status is QUEUED or RUNNING; stop when it is terminal.

---

## 5. Phases

Each phase is one PR. Open every PR as a **draft** and leave it in draft.

### Phase 1 — Unblock and stabilize
**Goal:** the documented README walkthrough actually works.

Changes: CORS middleware; `started_at` COALESCE fix; repositories return
`T | null`; `SIGTERM` handling in the worker and the scheduler; remove
`POST /runs/api-trigger` or document it.

Tests: a route test that asserts the CORS headers on a preflight `OPTIONS`; a
repository test for the missing-row path; a unit test that `started_at` survives
a second RUNNING transition.

**Acceptance:** bring up the stack, create a definition in the browser, run it,
and download an artifact. No CORS error in the browser console.

### Phase 2 — The step interpreter
**Goal:** the core of the mission. This is the largest phase.

Changes: the `Step` union and its validator; `upgradeScrapeConfig` for v1;
a step interpreter that replaces `runScrape`; named and templated artifacts;
`PDF` added to the `artifact_type` enum and to `CaptureType`; `artifacts.name`
and `artifacts.step_index` columns; limits enforced.

Tests: unit tests for the interpreter against a mocked Playwright `Page` and
`BrowserContext`, one per verb; nested `forEach` inside `paginate`; the v1-to-v2
upgrade mapping; name templating, sanitization, and collision handling; every
limit hit. Add tests for `toCsv`, which has none today.

**Acceptance:** a definition with `paginate` wrapping `forEach` wrapping
`openLink` and `capture` produces N named PNG artifacts against a local fixture
page served by the test.

### Phase 3 — Run reliability
Changes: attempt heartbeat and the stale-run sweeper; per-run timeout; one
browser per worker; the transactional scheduler claim; catch-up policy; the
error taxonomy.

Tests: a sweeper test with a fake clock; a timeout test; a scheduler test that
proves two concurrent pollers create exactly one run.

**Acceptance:** kill a worker mid-run. Within the stale window, the run reaches
FAILED with error code `STALE`.

### Phase 4 — Security and auth
Changes: the `secrets` table and its crypto; `AuthConfig` and the three modes;
the API key middleware; the URL guard.

Tests: round-trip encryption; a test that no API response body ever contains a
plaintext secret; URL guard cases for loopback, private ranges, link-local, and
non-HTTP schemes; a 401 test for every route.

**Acceptance:** a definition with `auth.mode = 'cdp'` scrapes a page that is
only reachable with the user's live session.

### Phase 5 — Delivery
Changes: `GET /runs/:id/artifacts.zip` as a streaming archive; an export CLI
(`npm run export -- --run <id> --out ./folder`); retention sweeper; run cancel
and rerun; pagination and status filters on the list endpoints.

Tests: a zip stream test; a retention test; pagination cursor tests.

**Acceptance:** one command writes every receipt image from a run into a local
folder.

### Phase 6 — Observability
Changes: `pino` everywhere; health endpoints on the worker and the scheduler
with compose healthchecks; failure diagnostics captured as artifacts; UI polling
on the run detail page.

**Acceptance:** a run that fails on a bad selector has a failure screenshot
attached, and the run page shows it without a manual reload.

### Phase 7 — The step editor
Changes: a UI to build and edit a step program — add, remove, reorder, and nest
steps; a raw JSON editor as the escape hatch; a definition edit page.

**Acceptance:** build the CourtReserve definition entirely in the browser.

### Phase 8 — Tests and CI
Changes: an integration suite against real Postgres, Redis, and MinIO, so every
repository query executes for real; an end-to-end test over the compose stack
against a local fixture site; a GitHub Actions workflow that runs typecheck,
lint, unit, and integration; a root lint and format setup; the `cron-parser` v5
upgrade.

**Acceptance:** CI is green on a push, and a deliberate SQL typo fails it.

### Phase 9 — The real job
Discover the CourtReserve selectors against the live page. Write the definition.
Run it. Export the receipts.

**Acceptance:** every receipt for the user's chosen date range lands in a local
folder as a named image.

---

## 6. Constraints and house rules

- Write a `plan.md` before each phase. Implement in the same session. Do not
  stop at a plan.
- Do not write code comments unless asked. The existing files have a few
  block comments that explain a non-obvious decision — match that density, and
  nothing more.
- Commit directly with git. Never push unless asked.
- Open every PR as a draft. Never mark a PR ready for review.
- Never chain shell commands with `&&` or `||`.
- Write all prose in Simplified Technical English.
- Test style: `parametrize` where it removes duplication; fixtures for reuse;
  focused tests scoped to the change. In React tests prefer
  `getByRole(role, { name })`.
- Keep `apps/web` out of the root `tsc -b` graph. It uses its own `check-types`.
- Never edit an applied migration. Add a new numbered file.
- Update `README.md` in any phase that changes how the stack is run or used.
- Update `docs/TODO.md` as items are closed. Do not delete an item; mark it done
  with the commit that closed it.

---

## 7. Verification

Run all of these before you call a phase complete.

```
npm run typecheck
npm run check-types --workspace @scraper/web
npm run lint --workspace @scraper/web
npm test
```

Note: `node_modules` may be absent. Run `npm ci`. Playwright browsers are a
separate download — run `npx playwright install chromium` before any test that
drives a real browser.

For a manual check of the whole stack:

```
docker compose up -d --build
docker compose ps
docker compose logs -f api worker scheduler
```

Write a Python or Node script for each phase's manual test. Do not verify by
hand alone.

---

## 8. Questions for the user

Ask these early. Do not let them block the phases that do not depend on them.

1. **Selector discovery.** Nobody can log in to CourtReserve except the user.
   How should the selectors be discovered? Options: the user pastes the
   relevant HTML; the user starts Chrome with `--remote-debugging-port=9222` and
   the agent attaches over CDP; the agent drives the browser through the
   Playwright MCP server or the Chrome extension. This answer decides whether
   `auth.mode = 'cdp'` is a Phase 4 item or must be pulled into Phase 2.
2. **Date range.** Which range of receipts is wanted? The screenshot shows
   `05/02/2026` to `07/31/2026` and two pages, but rows dated `12/19/2025` are
   visible, so the default range is wider than it appears.
3. **Output format.** PNG, PDF, or both? A PDF of a receipt is usually the more
   useful artifact, and `page.pdf()` is Chromium-only.
4. **Output location.** An exact local folder path for the export.
5. **Phase order.** This plan puts the real job last, after the platform is
   complete. If the receipts are needed sooner, Phases 2, 4-cdp, and 5-export
   are the minimum path, and the rest can follow.
