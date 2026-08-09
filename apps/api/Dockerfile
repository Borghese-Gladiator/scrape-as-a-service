FROM node:20-slim AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/db/package.json ./packages/db/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/scheduler/package.json ./apps/scheduler/package.json
COPY apps/web/package.json ./apps/web/package.json

RUN npm ci

COPY packages ./packages
COPY apps/api ./apps/api

RUN npm run build --workspace @scraper/shared
RUN npm run build --workspace @scraper/db
RUN npm run build --workspace @scraper/api

CMD ["node", "apps/api/dist/server.js"]
