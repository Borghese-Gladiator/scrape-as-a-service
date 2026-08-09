FROM node:20-slim AS builder
WORKDIR /app

# Browser-reachable API base URL is inlined into the client bundle at build time.
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}

# All workspace manifests are required for a deterministic `npm ci` against the
# root lockfile.
COPY package.json package-lock.json ./
COPY packages/db/package.json ./packages/db/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/scheduler/package.json ./apps/scheduler/package.json
COPY apps/web/package.json ./apps/web/package.json

RUN npm ci

COPY apps/web ./apps/web
RUN npm run build --workspace @scraper/web

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
