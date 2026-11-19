# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS base
RUN apk add --no-cache libc6-compat openssl
RUN npm install -g pnpm@10.34.9
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/compliance/package.json packages/compliance/package.json
COPY packages/pipeline/package.json packages/pipeline/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build
COPY . .
ENV DATABASE_URL="postgresql://user:pass@localhost:5432/db?schema=public"
RUN node node_modules/prisma/build/index.js generate --schema packages/database/prisma/schema.prisma

FROM base AS runtime
ENV NODE_ENV=production
RUN addgroup -g 1001 -S nodejs && adduser -S worker -u 1001
COPY --from=build --chown=worker:nodejs /app /app
USER worker
CMD ["node", "node_modules/tsx/dist/cli.mjs", "apps/worker/src/index.ts"]
