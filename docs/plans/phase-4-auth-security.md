# Phase 4 — secrets, session reuse, API key, and an SSRF guard

Branch: `phase-4-auth-security`. It stacks on `phase-2-step-interpreter`.

## Brief

Phase 2 made the scrape a step program. The program still runs anonymously, the
API is open to anybody who reaches the port, and the worker navigates to any URL
that a caller supplies. Phase 4 closes those three holes and gives the platform a
place to keep a credential.

It closes TODO 1.1, 3.1, 3.2, 3.3 and 3.4.

Four parts:

1. A secret store. AES-256-GCM at rest, one table, three API routes. The API
   never returns a plaintext value.
2. The four auth modes. `none`, `storageState`, `cdp`, `chromeProfile` and
   `login`. Phase 2 declared the union; Phase 4 executes it.
3. An API key on every route except `/health`.
4. A URL guard that rejects a private or a non-HTTP target.

## Decisions

### The encryption key loads late, not at import

`SECRET_ENCRYPTION_KEY` is not a field of `AppConfig`. The API needs it, the
worker needs it, and the scheduler does not. A required field in `loadConfig`
would stop the scheduler from starting. `packages/shared/src/crypto.ts` reads and
validates the key on the first call to `encryptSecret` or `decryptSecret`. The
key must decode to exactly 32 bytes from base64 or from hex, and a wrong length
throws at once with the byte count in the message.

### A missing `API_KEY` refuses to start in production only

`startApi` throws when `API_KEY` is empty and `NODE_ENV` is `production`. In any
other environment it prints a loud warning and runs with the check disabled. The
reason is the existing route tests and the local walkthrough: both construct the
server with no key. A hard failure everywhere would make every developer set a
key before the first `npm test`.

The comparison is timing safe. Both sides go through a SHA-256 digest first, so
`timingSafeEqual` always sees two 32-byte buffers and the key length never leaks.

### `chromeProfile` has its own flag

`ALLOW_CDP` gates `cdp`. `ALLOW_LOCAL_PROFILE` gates `chromeProfile`. They are
separate because the risks differ. `cdp` attaches to a browser that the user
already chose to expose on a debug port. `chromeProfile` reads the user's real
Chrome profile off the disk, which is a larger grant. Neither flag is on by
default.

### The URL guard is on in the production path only

`assertSafeUrl` is applied in `POST /definitions` and inside the interpreter on
every `goto` and every `openLink` target. The interpreter takes the guard as an
option, `assertUrl`. `runProgram` defaults that option to a function that does
nothing, and `runScrape` — the only path the worker uses — defaults it to the
real guard. The reason is test isolation: the Phase 2 interpreter tests drive a
fake page over invented URLs, and a real DNS lookup in a unit test is slow and
flaky. Production never calls `runProgram` directly.

The guard resolves the host with `node:dns` because a public name can resolve to
a private address, and a redirect can land on a different host than the one that
`POST /definitions` checked.

### `login` reuses a stored session when a cookie is still valid

The worker cannot ask a site whether a session is alive without spending a page
load. It can read the cookie expiry that the site itself wrote. A stored
`storageState` counts as fresh when it holds at least one cookie whose `expires`
is in the future. A session cookie (`expires` of -1) does not count, because it
dies with the browser that created it. A stale state makes the worker replay the
login steps and write the new state back to the secret.

### Artifact links move to a presigned URL

`GET /artifacts/:id/download` now needs the API key, and a browser cannot put a
header on an `<a href>`. The run detail page therefore asks
`GET /artifacts/:id/url` server side, where the key is available, and renders the
presigned URL that MinIO returns. The page falls back to the streaming URL when
the presign call fails.

## Changes

### `packages/shared`

- `src/crypto.ts` — new. `loadEncryptionKey`, `encryptSecret`, `decryptSecret`.
  The payload is `v1.<iv>.<tag>.<ciphertext>`, each part base64. The version
  prefix lets a later phase change the format without a guess.
- `src/url-guard.ts` — new. `assertSafeUrl(url, options?)` and
  `UrlNotAllowedError`. It allows `http` and `https` only, resolves the host,
  and rejects every non-global IPv4 and IPv6 range. `ALLOW_PRIVATE_URLS=true`
  turns the address check off; the scheme check stays on.
- `src/scrape-config.ts` — add the `chromeProfile` mode to `AuthConfig` and to
  `parseAuth`. Add `collectSecretRefs(config)`, which walks `auth` and every
  nested step and returns every secret name that the config needs.
- `src/config.ts` — add `allowCdp`, `allowLocalProfile` and `allowPrivateUrls`.
- `src/index.ts` — export the two new modules.

### `packages/db`

- `migrations/0004_secrets.sql` — the `secrets` table.
- `src/types.ts` — `SecretMeta`, which holds no ciphertext.
- `src/repositories/secrets.ts` — `upsertSecret`, `listSecrets`,
  `getSecretCiphertext`, `getSecretCiphertexts`, `deleteSecret`.

### `apps/api`

- `src/auth.ts` — new. `apiKeyMiddleware(apiKey)` and `requireApiKeyOrExit`.
- `src/routes/secrets.ts` — new. `POST`, `GET`, `DELETE /secrets/:id`.
- `src/routes/definitions.ts` — `await assertSafeUrl(url)` before the insert.
- `src/routes/artifacts.ts` — add `GET /artifacts/:id/url`.
- `src/server.ts` — mount the middleware and the router.

### `apps/worker`

- `src/auth.ts` — new. `createAuthSession` builds the browser context for the
  configured mode and returns what the caller must close.
- `src/scrape.ts` — use the auth session instead of `browser.newContext()`. In
  `cdp` mode it closes only the pages that the run opened.
- `src/secrets.ts` — new. `loadSecrets(db, names)` decrypts the named rows.
- `src/interpreter.ts` — add the `assertUrl` option and call it in `goto` and in
  `openLink`.
- `src/process-run.ts` — resolve the secrets a definition needs and pass them in.

### `apps/web`

- `src/lib/api.ts` — send `X-API-Key`; add `artifactPresignedUrl`.
- `src/lib/types.ts` — the new client method.
- `src/app/runs/[id]/page.tsx` — resolve presigned URLs server side.

### Documentation

- `README.md` — a security section: the API key, the secret store, the four auth
  modes, the URL guard, and how the browser gets a key.
- `.env.example` and `docker-compose.yml` — the new variables.
- `docs/TODO.md` — mark 1.1, 3.1, 3.2, 3.3 and 3.4 done.

## Tests

### Unit

| File | What it proves |
| --- | --- |
| `packages/shared/src/__tests__/crypto.test.ts` | A round trip returns the plaintext. A second encryption of the same text differs. A wrong key fails. A tampered auth tag fails. A bad key length fails at load. |
| `packages/shared/src/__tests__/url-guard.test.ts` | Parametrized. Loopback by name and by literal, every private range, link-local, unique-local, IPv6 forms, an IPv4-mapped IPv6 address, `file:`, `ftp:`, `javascript:`, a public name that resolves to a private address, the allowed case, and the bypass flag. |
| `packages/shared/src/__tests__/scrape-config.test.ts` | The `chromeProfile` mode parses. `collectSecretRefs` walks nested steps. |
| `apps/api/src/__tests__/auth.route.test.ts` | Parametrized over the route table: 401 with no key, 401 with a wrong key, and a pass with the right key. `/health` returns 200 with no key. |
| `apps/api/src/__tests__/secrets.route.test.ts` | `POST /secrets` stores a ciphertext, not the value. No body of `GET /secrets`, `GET /definitions` or `GET /runs/:id` holds the plaintext. |
| `apps/worker/src/__tests__/auth.test.ts` | Each mode builds the context it should. It asserts the argument to `newContext`, to `connectOverCDP` and to `launchPersistentContext`. A missing secret throws `AUTH_FAILED`. A disabled flag throws `AUTH_FAILED`. A fresh stored state skips the login steps; a stale one replays them and saves the result. |
| `apps/worker/src/__tests__/interpreter.test.ts` | Already proves `fill.valueFrom` and the missing-secret `AUTH_FAILED` (Phase 2). Add: `goto` and `openLink` call `assertUrl`. |

### Manual

`scripts/manual/phase-4-auth.mjs`, against a running API:

1. `GET /definitions` with no key returns 401.
2. `GET /health` with no key returns 200.
3. `POST /secrets` then `GET /secrets`: the value never appears in a response.
4. `DELETE /secrets/:id` removes it, and the script leaves no row behind.
5. `POST /definitions` with `http://169.254.169.254/` returns 400.

The stack for the run:

```
DATABASE_URL=postgres://postgres:postgres@localhost:55433/scraper
REDIS_URL=redis://localhost:56380
MINIO_ENDPOINT=localhost
MINIO_PORT=59002
```

### Verification

```
npm run typecheck
npm test
npm run check-types --workspace @scraper/web
npm run lint --workspace @scraper/web
node scripts/manual/phase-4-auth.mjs
node scripts/manual/phase-2-interpreter.mjs
```

## What Phase 4 does not prove

`cdp` and `chromeProfile` need a real Chrome on the host. The unit tests mock
Playwright, so they prove the arguments and the gates, not a live attachment.
Phase 9 must attach for real before it trusts either mode.
