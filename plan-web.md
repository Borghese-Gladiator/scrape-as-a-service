# plan-web.md

## brief
Build the Next.js + TypeScript frontend (`apps/web`) that talks to the `api` service. It provides:
- Create-definition flow (name, url, declarative selector/artifact editor)
- Definitions list view (landing page)
- Definition detail: manual Run action + schedules (create schedule w/ cron + timezone + enable toggle)
- Run-history list with status
- Run detail: per-run attempts, failure info, and artifact download links for completed runs
- Typed API client + env-based API base URL + minimal styling

## API surface (from apps/api)
- GET/POST `/definitions`
- GET `/schedules?definitionId=`, POST `/schedules`, PATCH `/schedules/:id` `{enabled}`
- GET `/runs?definitionId=`, GET `/runs/:id`, POST `/runs` `{definitionId}` (MANUAL)
- GET `/runs/:runId/artifacts`, GET `/artifacts/:id/download`

## changes
- apps/web/package.json (Next 14, react 18, deps + test deps)
- apps/web/tsconfig.json (Next TS config, standalone — NOT composite, jsx preserve)
- apps/web/next.config.js (env exposure NEXT_PUBLIC_API_BASE_URL)
- apps/web/.eslintrc.json (next/core-web-vitals)
- apps/web/next-env.d.ts
- apps/web/vitest.config.ts (jsdom env, react plugin, its own include)
- apps/web/vitest.setup.ts (@testing-library/jest-dom)
- apps/web/Dockerfile
- apps/web/src/lib/types.ts (DTO types mirroring api; dates as string over the wire)
- apps/web/src/lib/api.ts (getApiClient + ApiClient impl, artifactDownloadUrl)
- apps/web/src/app/globals.css (minimal styling)
- apps/web/src/app/layout.tsx (root layout + nav)
- apps/web/src/app/page.tsx (definitions list)
- apps/web/src/app/definitions/new/page.tsx (create form page)
- apps/web/src/app/definitions/[id]/page.tsx (detail: run action + schedules)
- apps/web/src/app/runs/page.tsx (run history)
- apps/web/src/app/runs/[id]/page.tsx (run detail)
- apps/web/src/components/DefinitionForm.tsx
- apps/web/src/components/ScheduleForm.tsx
- apps/web/src/components/RunList.tsx
- apps/web/src/components/RunDetail.tsx
- apps/web/src/components/__tests__/DefinitionForm.test.tsx
- apps/web/src/components/__tests__/RunDetail.test.tsx
- README.md (add web run instructions) — light touch

## design notes
- Client components ('use client') for interactivity; pages fetch via the api client.
- Dates arrive as ISO strings from JSON; frontend types use `string` for date fields.
- artifactDownloadUrl returns `${baseUrl}/artifacts/${artifactId}/download` (anchor href → working download).
- Keep apps/web OUT of the root `tsc -b` composite graph (it uses Next's own build). Root typecheck script unchanged; web is typechecked via its own `check-types`.

## tests
### unit (vitest + @testing-library/react, jsdom)
- DefinitionForm.test.tsx: renders name/url/field/artifact inputs; submitting calls onSubmit with parsed CreateDefinitionInput.
- RunDetail.test.tsx: renders status, attempts (attempt_number, error info on failure), and for a SUCCEEDED run renders artifact download links with correct href.
### targeted checks
- `npm run check-types --workspace @scraper/web` (tsc --noEmit)
- `npm run lint --workspace @scraper/web` (next lint)
- `npm run build --workspace @scraper/web` (next build)
- `npm run test --workspace @scraper/web` (vitest run)
### manual (browser)
1. `npm run dev --workspace @scraper/web`, open http://localhost:3000
2. Create definition → appears in list
3. Open definition → add schedule (cron+tz), toggle enable/disable
4. Click Run → run appears in history
5. Open a SUCCEEDED run → attempts shown, artifact download links work
