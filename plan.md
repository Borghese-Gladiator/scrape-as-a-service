# plan.md — Scrape-as-a-Service v2

Written 2026-09-12 against commit `49618b4`.

## Brief

`docs/TODO.md` lists every gap in the MVP. `docs/IMPLEMENTATION_PROMPT.md` turns
that list into nine phases. This plan executes all nine phases. Each phase is one
git worktree, one branch, one commit set, and one draft pull request.

The goal is one concrete job: open an authenticated CourtReserve transactions
table, click the Receipt control on every row of every page, capture each receipt
page, and write the set into a local folder.

## Default answers

Section 8 of the implementation prompt asks five questions. The user is away, so
this plan answers them with defaults and records them here.

1. **Selector discovery.** Use Chrome DevTools Protocol (CDP). The user starts
   Chrome with `--remote-debugging-port=9222`. The worker attaches to that Chrome
   and reuses the live session. This pulls `auth.mode = 'cdp'` into the critical
   path. Phase 9 also adds a `discover` CLI that prints candidate selectors from
   the live page, and ships best-guess Kendo UI selectors that the user can edit.
2. **Date range.** Default `01/01/2020` to today. The definition holds the two
   dates as literal `fill` values, so the user can change them.
3. **Output format.** Both PNG and PDF.
4. **Output location.** `./exports/<run-id>/`. The `--out` flag overrides it.
5. **Phase order.** Build every phase. Stack the critical path so the last branch
   contains a working end-to-end job: Phase 2, then 4, then 5, then 9.

## Changes

| Phase | Branch | Base | Scope |
| --- | --- | --- | --- |
| 1 | `phase-1-unblock` | `main` | CORS, `started_at` fix, repositories return `T \| null`, SIGTERM, `api-trigger` |
| 2 | `phase-2-step-interpreter` | `main` | The `Step` union, the validator, `upgradeScrapeConfig`, the interpreter, named artifacts, PDF |
| 3 | `phase-3-reliability` | `main` | Heartbeat, stale sweeper, run timeout, browser reuse, scheduler claim, catch-up, error taxonomy |
| 4 | `phase-4-auth-security` | `phase-2` | Secrets table and crypto, three auth modes, API key, URL guard |
| 5 | `phase-5-delivery` | `phase-2` | ZIP export, export CLI, local runner CLI, retention, cancel, rerun, pagination |
| 6 | `phase-6-observability` | `main` | pino, health servers, failure diagnostics, UI polling |
| 7 | `phase-7-step-editor` | `phase-2` | Step program editor, raw JSON editor, definition edit page |
| 8 | `phase-8-tests-ci` | `main` | Integration suite, end-to-end test, GitHub Actions, root lint and format, cron-parser v5 |
| 9 | `phase-9-courtreserve` | `phase-5` + `phase-4` | Selector discovery CLI, the CourtReserve definition, the receipts job |

## Tests

### Unit

Every phase adds unit tests next to the code it changes. The suite runs with
`npm test`. The largest set belongs to Phase 2: one test per step verb against a
mocked Playwright page, nested `forEach` inside `paginate`, the v1-to-v2 upgrade,
name templating and collisions, and every limit.

### Manual

Each phase writes a script under `scripts/manual/`. The script is Node, because
the stack is Node. Phase 9 adds the one that matters:

1. Start Chrome with `--remote-debugging-port=9222`.
2. Log in to CourtReserve.
3. Run `npm run job:receipts -- --out ./exports/receipts`.
4. Confirm the folder holds one PNG and one PDF for every receipt row.
