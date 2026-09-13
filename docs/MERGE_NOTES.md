# Merge notes

Written 2026-09-12. Nine branches were built in parallel worktrees. Every branch
is green on its own. This document records the order to merge them, and every
conflict the branch authors predicted or that review found.

## Merge order

Merge in this order. The order removes most conflicts by itself.

| Step | Branch | PR | Base |
| --- | --- | --- | --- |
| 1 | `phase-1-unblock` | #1 | `main` |
| 2 | `phase-3-reliability` | #2 | `main` |
| 3 | `phase-6-observability` | #3 | `main` |
| 4 | `phase-2-step-interpreter` | #4 | `main` |
| 5 | `phase-4-auth-security` | — | `phase-2` |
| 6 | `phase-5-delivery` | — | `phase-2` |
| 7 | `phase-7-step-editor` | — | `phase-2` |
| 8 | `phase-9-courtreserve` | #9 | `phase-5` + a merge of `phase-4` |
| 9 | `phase-8-tests-ci` | #5 | `main` |

PR numbers: #1 phase 1, #2 phase 3, #3 phase 6, #4 phase 2, #5 phase 8,
#6 phase 4, #7 phase 7, #8 phase 5.

Phase 8 merges LAST. It holds a bulk Prettier commit that touches nearly every
file. Any conflict against it resolves in favour of the other branch, followed
by `npm run format`.

## Known conflicts

### `apps/worker/src/scrape.ts` — three branches
The heaviest conflict. Resolve by hand, and keep all three changes:

- **Phase 2** rewrites the file around the step interpreter. Its `runProgram` is
  the engine. Keep it.
- **Phase 3** splits context creation into `openScrapeSession` and
  `closeScrapeSession`, so `processRun` can release the context when a run times
  out. Keep the split, and apply it to the Phase 2 version.
- **Phase 6** adds three small hooks: an import, one `collectConsole(page)` line
  after the page opens, and one `catch` that calls `attachDiagnostics`. All the
  logic sits in `apps/worker/src/diagnostics.ts`. Keep the two hooks.

### `apps/api/src/server.ts` and `.env.example` — RESOLVED, no conflict
Phase 8 briefly duplicated Phase 1's CORS middleware so its end-to-end preflight
assertion could pass on its own base. It removed that in commit `39fef04`, and
`git diff main` on both files is now empty. Phase 1 owns CORS alone. Phase 8's
end-to-end test covers the API contract only.

### Phase 4 and Phase 5 — 8 files, all additive
Both stack on Phase 2 and both touch the same files for different reasons. The
Phase 9 branch already carries this merge; resolve it the same way anywhere
else. Keep BOTH sides in every case:

| File | Phase 4 adds | Phase 5 adds |
| --- | --- | --- |
| `packages/shared/src/config.ts` | API key, `ALLOW_CDP`, `ALLOW_LOCAL_PROFILE`, `ALLOW_PRIVATE_URLS` | `RETENTION_DAYS` |
| `apps/api/src/routes/definitions.ts` | the SSRF guard on the URL | read-one, update, soft delete |
| `apps/api/src/routes/artifacts.ts` | `GET /artifacts/:id/url`, the key | the zip route, the name-based filename |
| `apps/web/src/lib/api.ts` | sends the API key | definition routes, pagination, cancel, rerun, `runArchiveUrl` |
| `.env.example`, `README.md`, `apps/web/src/lib/types.ts`, `apps/web/src/app/runs/[id]/page.tsx` | additive | additive |

Two resolutions are not purely mechanical: apply the SSRF guard to Phase 5's
update path as well as its create path, and make every Phase 5 client method
send Phase 4's API key.

### `apps/worker/src/process-run.ts` — Phase 3 and Phase 6
Phase 3 adds the heartbeat timer and the timeout race. Phase 6 adds the
diagnostics upload before `finalizeFailure`. The two edits sit in different
parts of the function. Keep both.

### The error taxonomy — Phase 2 and Phase 3
No conflict remains. Phase 3's `toErrorCode` honours a duck-typed `code` field,
which is how Phase 2's `StepError` carries its code. Confirmed: Phase 2 throws
only `LIMIT_EXCEEDED`, `AUTH_FAILED`, `SELECTOR_NOT_FOUND`, and `UNKNOWN`, and
all four are verbatim members of Phase 3's union.

### Phase 8's end-to-end fixture — Phase 2
`apps/api/src/__itests__/e2e.itest.ts` builds a v1 `ScrapeConfig`. Phase 2 makes
`POST /definitions` upgrade a v1 config on write, so the stored value changes
shape. Update the fixture's assertion to the v2 shape when Phase 8 merges.

### Migrations — no conflict
Numbers were assigned before the work started: `0002_step_programs.sql`
(phase 2), `0003_run_reliability.sql` (phase 3), `0004_secrets.sql` (phase 4),
`0005_delivery.sql` (phase 5). The runner applies files in filename order.

## Open items that belong to no branch

- `npm run migrate` fails without `REDIS_URL`, `MINIO_ACCESS_KEY`, and
  `MINIO_SECRET_KEY`, because `getPool` calls the full `loadConfig`. The
  migration needs only the database URL. Pre-existing. Phase 3 found it and
  correctly did not widen its scope.
