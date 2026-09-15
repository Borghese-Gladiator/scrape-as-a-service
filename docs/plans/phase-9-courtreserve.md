# Phase 9 — the CourtReserve receipts job

Branch `phase-9-courtreserve`. It stacks on `phase-5-delivery` and it carries a
merge of `phase-4-auth-security`.

## Brief

Phase 2 built the step interpreter. Phase 4 built the session reuse. Phase 5
built the local runner. Phase 9 uses all three to express one real job as data:
retrieve the user's own payment receipts from their CourtReserve account.

Target page:
`https://app.courtreserve.com/Online/MyBalance/Index/13140?page=details`

The job:

1. Reach the balance page with the user's own browser session.
2. Select the `Payments` sub-tab.
3. Set the date range.
4. For every row, on every page of the pager: read the row, open the receipt,
   capture it as PNG and PDF.
5. Write every capture to a local folder in one command.

## THE UNVERIFIED SELECTORS

**Read this block first. Every selector in this table is a guess.**

The page is behind a login, and behind Cloudflare. An anonymous request returns
the login page at best and a Cloudflare challenge at worst, so no selector in
the transactions table is readable without the user's session. Nobody has seen
the real markup. The values below come from two sources, and neither source is
the page itself:

- The page loads `/Scripts/kendo/2022.1.301/cultures/kendo.culture.en-US.min.js`.
  The table is therefore near certain to be a Kendo UI for jQuery Grid, at
  version 2022.1.301. The selectors below are the **Kendo 2022.1 defaults**.
- The layout of the page comes from screenshots, which show text and position
  but no markup.

| Purpose | Ships as | Confidence | How to confirm |
| --- | --- | --- | --- |
| `Payments` sub-tab | `.k-tabstrip .k-item > .k-link:has-text("Payments")` | Low | Discovery report, "tab strips" |
| Start date input | `#StartDate` | Low | Discovery report, "date inputs" |
| End date input | `#EndDate` | Low | Discovery report, "date inputs" |
| Table row | `.k-grid-content tbody tr.k-master-row` | Medium | Discovery report, "grids" |
| Pager next | `.k-pager-wrap a.k-pager-nav[title="Go to the next page"]` | Medium | Discovery report, "pager controls" |
| Row cell, date | `td:nth-child(1)` | Low | Discovery report, column headers |
| Row cell, amount | `td:nth-child(2)` | Low | Discovery report, column headers |
| Row cell, paid date | `td:nth-child(3)` | Low | Discovery report, column headers |
| Row cell, payment type | `td:nth-child(4)` | Low | Discovery report, column headers |
| Receipt control | `a.k-button` | Low | Discovery report, "row controls" |

The point of Task 1 is to make every one of these a fact instead of a guess, in
one command, against the user's live session. Do not treat the table as
verified until the discovery report confirms each line.

Two notes that are facts, not guesses:

- Kendo 2022.1 marks a dead pager arrow with `.k-state-disabled`. Later versions
  use `.k-disabled`. The interpreter's `isDisabled` tests whether the class
  attribute *contains* `disabled`, so both spellings already stop the pager.
- The site also loads `/ClientApp/bundle.js`, `/Scripts/reactapp.js` and
  `pdf.js` 2.2.2. A receipt may therefore render inside a PDF viewer rather
  than as HTML. The discovery report prints each row control's `href` and
  `target`, which tells the user which of the two definition shapes to run.

## Decisions

### 1. The discovery CLI reads the DOM with one constant script

`npm run discover` must report, for every candidate grid, the id, the classes,
the column headers and the row count; then every control in the first data row;
then the pager, the tab strips and the date inputs. A pure-locator walk needs
one round trip per attribute of per element, which is hundreds of round trips
and minutes of wall time on a real page.

The report therefore comes from a single `page.evaluate` of one function that
this repository owns, `collectDiscovery` in
`apps/worker/src/cli/discover-script.ts`. The mission forbids the evaluation of
**user-supplied** JavaScript. This function takes no input, reads no
configuration, and is compiled from this repository's own source. Phase 2 set
the precedent with `SCROLL_TO_BOTTOM`.

The function is self-contained: no imports and no closure references, because
Playwright serializes its source and runs it in the page.

It is unit tested against jsdom, with a fixture that carries Kendo class names.

### 2. The receipt control ships in two shapes

Nobody knows whether the Receipt control is an anchor with an `href` or a
button with a JavaScript handler. Both shapes ship:

- `definitions/courtreserve-receipts.json` uses `openLink`. It reads the `href`,
  opens it in a fresh page, captures, and closes the page. This is the default
  because it never depends on popup timing.
- `definitions/courtreserve-receipts-newtab.json` uses `click` with
  `opens: 'newTab'`, then `capture`, then `goBack`. Use it when the control is
  a handler and carries no usable `href`.

The discovery report decides which: it prints `href` and `target` for every
control in the first row.

### 3. The date range sits at the top of the file

`fill` takes a literal `value`. The two date steps are therefore the first two
steps after the tab click, so a person editing the file finds them at once. The
default range is `01/01/2020` to today, which is wider than the screenshot
range and retrieves the whole history.

### 4. Every window the job opens is visible, because Cloudflare blocks headless

Measured against the live URL on 2026-09-13:

| Browser | Page title returned |
| --- | --- |
| Headless Chromium | `Attention Required! \| Cloudflare` |
| Headed Chromium | `Login \| powered by CourtReserve` |

CourtReserve sits behind Cloudflare, which serves a headless browser a
challenge page instead of the site. Playwright launches a persistent Chrome
profile **headless by default**, so `auth.mode=chromeProfile` would fail on
every run, and the failure would look like a missing selector rather than a
block.

`apps/worker/src/cli/chrome-profile.ts` therefore wraps the Playwright
`chromium` object and forces `headless: false` on `launchPersistentContext`.
Both the discovery CLI and the job use the wrapper. The `cdp` mode needs no
wrapper: it attaches to the window the user already opened, which Cloudflare
has already cleared. That makes `cdp` the mode to prefer, and the documentation
says so.

The wrapper is the smallest change that works. It touches no Phase 4 code: it
is a decorator over an interface Phase 4 already accepts as a dependency.

### 5. `npm run job:receipts` wraps the local runner

The job script is a thin wrapper over the Phase 5 `run-local` CLI. It adds the
auth mode, the session flags, and one job-shaped error message. It does not
duplicate the runner.

The browser-not-reachable case is the failure the user will actually hit, so it
gets a named error that states the exact fix, including the quit-Chrome-first
step.

### 6. The fixture is CourtReserve-shaped, and the real definition runs against it

The live page needs the user's session, so it cannot be an automated test.
`scripts/manual/phase-9-courtreserve-fixture.mjs` serves a grid with the real
Kendo class names, three pages, a working next arrow and a `.k-state-disabled`
arrow on the last page.

The acceptance test loads `definitions/courtreserve-receipts.json` from disk,
overrides **only** the base URL and the auth mode, runs it, and asserts the
exact file count and the exact file names. This proves the structure of the
shipped definition, not a copy of it.

## Changes

### A. `apps/worker/src/cli/discover-script.ts`

`collectDiscovery(): DiscoveryReport` and its result types. Self-contained.
It collects:

- `grids`: every `table`, `.k-grid` and `[role=grid]`, with tag, id, classes,
  header texts, row count, and the selector that matched the rows.
- `rowControls`: for the first data row of each grid, every `a`, `button`,
  `input[type=button]` and `input[type=submit]`, with tag, text, id, classes,
  `href`, `target`, `onclick` presence, and `newTab`.
- `pagers`: every `.k-pager-wrap`, `.pager`, `[role=navigation]` and their
  controls, with text, classes, title, and `disabled`.
- `tabStrips`: every `.k-tabstrip`, `[role=tablist]`, `ul.nav-tabs`, with item
  labels and the active item.
- `dateInputs`: every `input` whose type, id, name, class or placeholder
  suggests a date, with id, name, value and placeholder.

### B. `apps/worker/src/cli/discover.ts`

```
npm run discover -- --url <url> [--cdp http://localhost:9222] [--profile] [--out <file.json>]
```

It builds the auth config from the flags, opens the URL through
`createAuthSession`, evaluates `collectDiscovery`, prints a readable report, and
writes the JSON. The suggestion block names a `rowSelector`, a `nextSelector`
and a receipt-control selector, each with the evidence that produced it.

### C. `apps/worker/src/cli/chrome-profile.ts`

`headedChromium(base)`, the wrapper that forces a visible window on the profile
mode. See decision 4.

### D. `definitions/courtreserve-receipts.json` and `-newtab.json`

The v2 `ScrapeConfig` for the job, in both receipt-control shapes.

### E. `scripts/job-receipts.mjs` and `npm run job:receipts`

### F. `scripts/manual/phase-9-courtreserve-fixture.mjs`

### G. `docs/RECEIPTS.md`, linked from `README.md`

### H. The merge fallout in `apps/worker/src/cli/run-local.ts`

The merge of Phase 4 put the SSRF guard on the path the Phase 5 runner takes.
The runner therefore gains `--allow-private`, `--allow-cdp` and
`--allow-profile`, and a `chromium` dependency so a caller can supply the
headed wrapper.

## Tests

### Unit

| File | What it proves |
| --- | --- |
| `apps/worker/src/__tests__/discover-script.test.ts` | `collectDiscovery` against a jsdom Kendo fixture: it finds the grid, the headers, the row count, the row controls with `href` and `target`, the disabled pager arrow in both class spellings, the tab strip labels, and the date inputs. |
| `apps/worker/src/__tests__/discover.test.ts` | The report formatter and the suggestion logic: a Kendo grid suggests `tr.k-master-row`; an anchor row control suggests `openLink`; a handler row control suggests the new-tab shape. |
| `apps/worker/src/__tests__/courtreserve-definition.test.ts` | The shipped definition files pass `validateScrapeConfig`, carry the expected step shape, and the two files differ only in the receipt-control step. |
| `apps/worker/src/__tests__/chrome-profile.test.ts` | `headedChromium` forces `headless: false` on the profile launch, overrides a caller that asked for headless, and leaves the CDP path alone. |

### Manual

`node scripts/manual/phase-9-courtreserve-fixture.mjs`

It builds the worker first, so a stale `dist` cannot report a failure that the
source does not hold. Then it serves the Kendo-shaped fixture and runs two
parts.

**Part 1, the discovery CLI.** It runs `discover` against the fixture through
real Playwright, which also proves that Playwright can serialize
`collectDiscovery` and run it in the page. It asserts that the report finds the
grid by id, reads the five headers, counts the rows, reads the Receipt `href`,
finds both date inputs, sees that the `Payments` tab is active, and suggests
`tr.k-master-row`, the **next** arrow rather than the previous one, and the
`openLink` shape.

**Part 2, the shipped definition.** It runs
`definitions/courtreserve-receipts.json` from disk with only the base URL and
the auth mode overridden, and asserts:

- 8 rows over 3 pages,
- 8 PNG files and 8 PDF files with the exact expected names,
- `receipts.json` and `receipts.csv` with all 8 rows and all four fields,
- 18 files on disk, and no file that is not expected,
- that the pager stopped on the `.k-state-disabled` arrow rather than looping.

It needs only Chromium. It needs no Postgres, no Redis and no MinIO.

## What this phase cannot prove

The selectors. They need the user's live session, and no test in this
repository can have one. The fixture proves the definition's **structure**: the
pager, the per-row loop, the nested capture, the name template, and the file
names. It cannot prove that `.k-master-row` is what CourtReserve actually
serves. Only `npm run discover`, run by the user, can do that.
