# Phase 2 — The step interpreter

## Brief

The scraper does one pass: navigate, wait for one selector, read fields, capture
the entry page. It cannot click, paginate, follow a row link, or produce more
than one image. This phase replaces that pass with an ordered step program.

A scrape definition stays data. Each capability is a new step verb with a closed
schema. The validator checks the schema before storage. The interpreter is a
`switch` over a discriminated union. The platform never evaluates JavaScript
that a user supplies.

## Changes

### `packages/shared/src/scrape-config.ts` (rewrite)

- Add `PDF` to `ArtifactType`. Add `CaptureType` (`PNG | PDF | HTML`) and
  `WaitUntil`.
- Add the `Step` discriminated union with 13 verbs, `AuthConfig`, `Limits`,
  and `DEFAULT_LIMITS`.
- `ScrapeConfig` becomes `{ version: 2; auth?; steps; limits?; record?;
  upgradedFrom? }`.
- `isV1Config(input)` returns true when the input is an object with no
  `version` key.
- `upgradeScrapeConfig(input)` validates the v1 shape, then maps it to v2.
- `validateScrapeConfig(input)` accepts v1 or v2 and always returns v2. It
  upgrades a v1 input. It clamps each limit to its hard cap.
- Remove `ScrapeResult`. The interpreter owns the result shape now.

### `apps/worker/src/names.ts` (new)

`resolveNameTemplate`, `sanitizeArtifactName`, and `uniqueArtifactName`.
Templates accept `{{index}}`, `{{page}}`, and `{{row.<field>}}` only. There is
no expression support and no function call support.

### `apps/worker/src/interpreter.ts` (new)

`runProgram(context, url, config, options)` executes the step list and returns
`{ datasets, artifacts }`. It holds a page stack, a scope (a `Locator` or the
page), and a bindings record for name templates. It enforces the four limits.

### `apps/worker/src/scrape.ts` (rewrite)

`runScrape` keeps its outer signature. It creates the context, records video
when `config.record` is true, calls `runProgram`, and always closes the context.

### `apps/worker/src/artifacts.ts`

`buildAndUploadArtifacts` uploads `result.artifacts` and returns the type, the
name, the step index, and the put result. `toCsv` is unchanged.

### `apps/worker/src/process-run.ts`

Call `validateScrapeConfig` on the stored config, so an old v1 row still runs.
Pass the artifact name and the step index to `insertArtifact`.

### Database

`packages/db/migrations/0002_step_programs.sql` adds the `PDF` enum value and
the `name` and `step_index` columns on `artifacts`. `packages/db/src/types.ts`,
`packages/db/src/repositories/artifacts.ts`, and `apps/web/src/lib/types.ts`
follow.

### `apps/web`

The type module gains `PDF`, the v2 config types, and the two new artifact
columns. It keeps `ScrapeConfigV1` so that `DefinitionForm` still compiles.
Phase 7 owns the step editor. The definition detail page prints the step
program instead of the v1 field table. The run detail page shows the artifact
name.

## Decisions

### Where the JSON and the CSV artifact of an `extract` come from

`extract` accumulates rows into `datasets[name]`. The interpreter emits one
JSON artifact per dataset at the end of the program, not once per execution of
the step. A `paginate` that runs an `extract` on 5 pages therefore produces one
`rows.json` that holds every row, not 5 files. The CSV artifact follows the
same rule and appears when any `extract` for that dataset sets
`emit: ['JSON','CSV']`.

### How an upgraded v1 config keeps the v1 artifact filenames

The v1 mapping names the extract step `rows` and the capture step `page`, as
`docs/IMPLEMENTATION_PROMPT.md` section 4.2 states. Those names produce
`rows.json`, `rows.csv`, `page.png`, and `page.html`, which are not the v1
filenames.

`upgradeScrapeConfig` therefore sets `upgradedFrom: 1` on the config it
returns. `buildAndUploadArtifacts` reads that marker and applies one fixed
rename table:

```
rows.json -> data.json
rows.csv  -> data.csv
page.png  -> screenshot.png
page.html -> source.html
```

The marker is data, it survives the JSONB round trip, and it keeps the rename
in one place. A v2 config that a user writes never carries the marker, so its
names come from its own templates.

### How a v1 `WEBM` request keeps working

`WEBM` is not a `CaptureType`, because Playwright records video on the context,
not on a step. `ScrapeConfig` gains `record?: boolean`. The v1 upgrade sets it
when the v1 `artifacts` list holds `WEBM`. `runScrape` passes
`recordVideo` to `browser.newContext`, and appends one `recording.webm`
artifact after it closes the context.

### Limits

`DEFAULT_LIMITS` supplies a missing value. The validator clamps a supplied
value to the hard cap. The interpreter counts executed steps, navigations, and
artifacts, and reads the clock before each step. A breach throws an error whose
`code` and `name` are both `LIMIT_EXCEEDED`. `process-run.ts` reads `name`
today, so both fields carry the code until Phase 3 adds the error taxonomy.

### `scroll to: 'bottom'`

The interpreter calls `page.evaluate` with a constant function that this
repository owns. The mission forbids the evaluation of user-supplied
JavaScript. A fixed internal function is not user input, and there is no
selector-only way to scroll a window to its end.

## Tests

### Unit

- `packages/shared/src/__tests__/scrape-config.test.ts` — one accept case and
  one reject case per verb, parametrized; an unknown `op`; `fill` with both
  `value` and `valueFrom` and with neither; limit clamping.
- `packages/shared/src/__tests__/upgrade-config.test.ts` — the full v1 mapping,
  one case per v1 artifact type.
- `apps/worker/src/__tests__/names.test.ts` — template resolution,
  sanitization (unicode, slashes, `..`, empty), truncation, collisions.
- `apps/worker/src/__tests__/interpreter.test.ts` — one test per verb against
  the fake in `apps/worker/src/__tests__/fake-playwright.ts`. Also: `forEach`
  inside `paginate`; `openLink` open and close; `click` with `opens: 'newTab'`
  then `goBack`; `paginate` stop on a disabled control; `paginate` stop on an
  unchanged page; each of the four limits.
- `apps/worker/src/__tests__/artifacts.test.ts` — `toCsv` quoting, commas,
  quotes, newlines, an empty row set, a ragged key union; the v1 rename table.
- The two API route tests stay in place. The accept case now asserts the stored
  v2 shape, because `POST /definitions` upgrades on write.

### Manual

`scripts/manual/phase-2-interpreter.mjs`:

1. Serve a fixture site from `node:http`: a table of 3 rows per page, a
   `Receipt` anchor on each row, and a pager with 2 pages.
2. Launch Chromium through Playwright.
3. Run a v2 config: `paginate` wraps `forEach`, which wraps `openLink` and
   `capture`.
4. Write every artifact to a temporary folder, print the names, and exit
   non-zero when the count is wrong.

Run it with `node scripts/manual/phase-2-interpreter.mjs`.

### Verification

```
npm run typecheck
npm test
npm run check-types --workspace @scraper/web
npm run lint --workspace @scraper/web
node scripts/manual/phase-2-interpreter.mjs
```
