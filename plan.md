# Plan: Monorepo root + shared foundation (packages/db, packages/shared)

## Brief
Create the monorepo workspace root and the two foundational packages every service depends on:
- `packages/db`: PostgreSQL schema, SQL migration, migration runner, typed data-access repos.
- `packages/shared`: config/env loader, BullMQ queue module, MinIO/S3 storage wrapper, cron+timezone next-run helper, scrape-config validation.

Scope is the shared foundation only (this slice). apps/* (api, worker, scheduler, web) are out of scope for this slice.

## Changes
### Root
- package.json (npm workspaces: packages/*, apps/*), scripts
- tsconfig.base.json (strict, ES2022, NodeNext, composite)
- .gitignore
- .env.example
- README.md

### packages/db
- package.json, tsconfig.json
- src/schema.sql (DDL + enums)
- migrations/0001_init.sql
- src/client.ts (pg Pool singleton)
- src/types.ts (row/entity types + enum unions)
- src/migrate.ts (runMigrations + migrateCli)
- src/repositories/{definitions,schedules,runs,attempts,artifacts}.ts
- src/index.ts (barrel)

### packages/shared
- package.json, tsconfig.json
- src/config.ts (loadConfig -> AppConfig)
- src/queue.ts (BullMQ getQueue/getRedisConnection/defaultJobOptions/enqueueRun)
- src/storage.ts (MinIO StorageClient: ensureBucket/put/getStream + runObjectKey)
- src/cron.ts (computeNextRun via cron-parser + luxon/tz)
- src/scrape-config.ts (validateScrapeConfig)
- src/index.ts (barrel)

## Tests
### Unit
- packages/shared/src/__tests__/cron.test.ts — known cron/tz -> expected next_run_at
- packages/db/src/__tests__/status-transitions.test.ts — run QUEUED->RUNNING->SUCCEEDED,
  attempt insert with incrementing attempt_number (against a fake/mock pg client using schema types)

### Manual / targeted checks
- tsc typecheck both packages
- SQL migration applies cleanly against ephemeral Postgres in Docker (or psql parse)
