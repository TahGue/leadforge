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
# Lifecycle scripts are not needed to install; Prisma is generated explicitly.
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build
COPY . .
# Public map style is inlined into the client bundle at build time.
ARG NEXT_PUBLIC_MAP_STYLE_URL=""
ENV NEXT_PUBLIC_MAP_STYLE_URL=${NEXT_PUBLIC_MAP_STYLE_URL}
# Prisma needs a syntactically valid URL at generate time; it does not connect.
ENV DATABASE_URL="postgresql://user:pass@localhost:5432/db?schema=public"
RUN node node_modules/prisma/build/index.js generate --schema packages/database/prisma/schema.prisma
ENV NEXT_TELEMETRY_DISABLED=1
RUN node scripts/copy-maplibre-worker.mjs && cd apps/web && node ../../node_modules/next/dist/bin/next build

FROM base AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=build --chown=nextjs:nodejs /app /app
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "node_modules/next/dist/bin/next", "start", "apps/web", "-p", "3000"]
