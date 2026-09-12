# Phase 5 — Delivery

Branch `phase-5-delivery`. It stacks on `phase-2-step-interpreter`.

## Brief

Phase 2 made a run produce N named artifacts. Phase 5 makes a person able to get
those artifacts out, and makes the platform usable with no stack at all.

The phase closes `docs/TODO.md` items 1.7, 4.1, 4.3, 4.4 and 4.5.

The most important item is the local runner CLI. The real target job runs against
a browser session on the user's own machine. A Docker worker cannot reach that
session. The platform must therefore run one definition end to end with no
Postgres, no Redis, and no MinIO.

## Decisions

### 1. `archiver`, not `yazl`

`archiver` takes a Node readable per entry (`archive.append(stream, { name })`),
pipes into the Express response, and ships `@types/archiver`. It needs no entry
size in advance, so the route never reads an object into memory. `yazl` needs the
byte size for `addReadStream` to avoid a data descriptor, which means the route
must trust `artifacts.size_bytes` or buffer. `archiver` is the smaller change.

The unpack side uses `yauzl`, the streaming reader that pairs with the format.
Node has no built-in reader for the ZIP container.

### 2. `CANCELLED` reuses `FAILED` plus an error code

The migration does not add a fifth `run_status` value. A cancel marks the run
`FAILED` and writes the error code `CANCELLED` on the attempt.

Reason: the `run_status` enum is mirrored in `packages/db/src/types.ts`, in
`apps/web/src/lib/types.ts`, and in `RUN_COMPLETE_STATUSES`. A fifth value forces
every consumer to branch again, and it carries no information that the error code
does not already carry. Phase 3 owns the error taxonomy; `CANCELLED` joins it.

A cancel of a `QUEUED` run has no attempt row yet, so the route inserts one and
fails it at once. The attempt is the only place the schema can hold a reason.

### 3. Both CLIs live in `apps/worker/src/cli/`

No new workspace. The worker already depends on Playwright, on `@scraper/shared`,
and on a `tsc -b` build, which is exactly what the local runner needs. A separate
`apps/cli` workspace would need its own `package.json`, `tsconfig.json`, and
Playwright dependency for no gain.

The export CLI needs no browser and no database. It speaks HTTP to the API.

## Changes

### A. The local runner CLI — `apps/worker/src/cli/run-local.ts`

```
npm run run-local -- --definition ./def.json --out ./folder [--headed] [--timeout 60000] [--url https://…]
```

- Read the JSON file. Accept two shapes: a full definition
  (`{ name?, url, config }`) or a bare config (`{ version: 2, steps: [...] }`).
- Resolve the URL: `--url` wins, then `file.url`. Fail when neither is present.
- Validate with `validateScrapeConfig`. A v1 config upgrades, as it does on the
  API write path.
- `--timeout` overwrites `limits.maxDurationMs`. The validator clamps it.
- Launch Chromium with `headless: !headed`.
- Run `runScrape`. Write every artifact to `<out>/<name>`, where the name comes
  from `artifactFilename(config, artifact.name)`, so a v1 definition keeps its
  v1 filenames.
- Print one line per artifact: type, name, byte count. Print a summary count.
- On failure print `error <CODE>: <message>` and exit 1. The code is
  `StepError.code` when the interpreter threw, else `UNKNOWN`.

The module exports `runLocal(options, deps)` with an injectable `launchBrowser`
and an injectable `log`, so a test drives it with the fake Playwright context.

Root script: `"run-local": "tsc -b apps/worker && node apps/worker/dist/cli/run-local.js"`.

### B. Bulk export

**`GET /runs/:id/artifacts.zip`** in `apps/api/src/routes/artifacts.ts`.

- 404 when the run does not exist, and when it holds no artifact.
- Set `Content-Type: application/zip` and a `Content-Disposition` filename of
  `run-<id>.zip`.
- Open one object stream at a time and append it to the archive. The entry name
  is `artifact.name`, or the basename of `object_key` when `name` is null. A
  repeat name gets `-2`, `-3` before the extension.
- `store: true` (no deflate). A PNG and a PDF do not compress, and the CPU cost
  is real.

**`npm run export -- --run <id> --out ./folder`** in
`apps/worker/src/cli/export.ts`.

- `--api` or `API_BASE_URL` gives the base URL. Default `http://localhost:4000`.
- Fetch the zip route, unpack with `yauzl` into the folder, print each file and
  a count. Exit 1 on an HTTP error.
- `apps/worker/src/cli/unzip.ts` holds `unpackZip(source, outDir)`. The export
  CLI and the manual script both use it.

### C. API completeness

`packages/db/migrations/0005_delivery.sql`:

```sql
ALTER TABLE scrape_definitions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_scrape_definitions_keyset ON scrape_definitions (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_scrape_runs_keyset ON scrape_runs (created_at DESC, id DESC);
```

Routes:

| Route | Behavior |
| --- | --- |
| `GET /definitions/:id` | 404 when the row is absent. A soft-deleted row still answers. |
| `PUT /definitions/:id` | `name`, `url`, `config` are each optional. Validate `config`. 404 when absent or deleted. |
| `DELETE /definitions/:id` | Soft delete. Sets `deleted_at`. 204. |
| `DELETE /schedules/:id` | Hard delete. 204. |
| `POST /runs/:id/cancel` | See decision 2. 409 when the run already finished. |
| `POST /runs/:id/rerun` | New `MANUAL` run from the same definition. 201. |

Pagination on `GET /runs` and `GET /definitions`: keyset over
`(created_at DESC, id DESC)`. `?limit=` defaults to 50 and clamps to 200.
`?cursor=` is base64url of `<created_at ISO>|<id>`. The body becomes
`{ items: [...], nextCursor: string | null }`. `GET /runs` also takes `?status=`.

A soft-deleted definition drops out of `GET /definitions`, and
`POST /runs` against it returns 409. `findDueSchedules` joins the definition and
skips a deleted one, so a stale schedule cannot keep creating runs.

### D. Retention — `apps/scheduler/src/retention.ts`

`sweepRetention({ db, storage, now, retentionDays, limit })`.

- `retentionDays === 0` disables the sweeper; it returns zeros and runs no query.
- Select runs with `created_at < now - retentionDays`, oldest first, `limit` rows.
- For each run: list the artifacts, `storage.remove` every object, then delete
  the run row. The artifact rows go with it through `ON DELETE CASCADE`.
- Objects first, then rows. A crash in between leaves a deletable row, never an
  orphan object.
- Returns `{ runsDeleted, objectsDeleted }`.

`StorageClient` gains `remove(objectKey)`. `AppConfig` gains `retentionDays` from
`RETENTION_DAYS`, default 30.

`apps/scheduler/src/index.ts` runs the sweeper once at start and then every hour.

### E. The web client

- `getDefinition` calls `GET /definitions/:id` instead of listing every row.
- `listDefinitions` and `listRuns` read `items` out of the paginated body.
- `ScrapeDefinition` gains `deleted_at`.

The `ApiClient` interface still returns arrays, so no component changes.

## Tests

### Unit — `vitest`

| File | Cases |
| --- | --- |
| `apps/api/src/__tests__/artifacts-zip.route.test.ts` | Three artifacts over a fake storage; entry names and bytes after `yauzl` unpack; a null `name` falls back to the key basename; a duplicate name gets a suffix; the response sends its first bytes before the last object is opened, which proves the route streams; 404 for an unknown run. |
| `apps/api/src/__tests__/pagination.route.test.ts` | A first page, a follow-up cursor, a stable order across the two pages, the limit clamp at 200, the default of 50, and the `?status=` filter. |
| `apps/api/src/__tests__/definitions-crud.route.test.ts` | A soft-deleted definition is absent from the list, still answers `GET /definitions/:id`, and returns 409 from `POST /runs`. `PUT` validates the config. `DELETE /schedules/:id`. |
| `apps/api/src/__tests__/run-actions.route.test.ts` | `it.each` over a `QUEUED` run and a `RUNNING` run: the queued case removes the BullMQ job; both mark the run `FAILED` with the error code `CANCELLED`. A finished run gives 409. `rerun` creates a second run and enqueues it. |
| `apps/scheduler/src/__tests__/retention.test.ts` | A fake clock and a fake storage. Objects are removed before the row is deleted; a run inside the window survives; `RETENTION_DAYS=0` deletes nothing. |
| `apps/worker/src/__tests__/run-local.test.ts` | The local runner against the Phase 2 fixture site, modeled with `FakeContext`. It writes every artifact to a real temporary folder, prints one line per artifact, and exits non-zero with the error code when a step fails. |

### Manual — `scripts/manual/phase-5-export.mjs`

1. Serve the Phase 2 fixture site, extended with a third page
   (`scripts/manual/fixture-site.mjs`). The Phase 2 script keeps its own copy,
   so this change cannot regress it.
2. Run the local runner CLI into a temporary folder. Assert the file count and
   every filename on disk.
3. Apply the migrations, store those files as the artifacts of a real run, start
   the API in the same process, and export the run with the export CLI. Compare
   the bytes of every unpacked file against the file the runner wrote.
4. Delete every row and object that the script created.
5. Exit non-zero on any mismatch.

## Verification

```
npm run typecheck
npm test
npm run check-types --workspace @scraper/web
npm run lint --workspace @scraper/web
node scripts/manual/phase-5-export.mjs
node scripts/manual/phase-2-interpreter.mjs
```
