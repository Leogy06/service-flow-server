# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS build
COPY package.json package-lock.json ./
# Generation runs explicitly below after its schema/configuration are present.
RUN npm ci --include=dev --ignore-scripts
COPY tsconfig.json tsconfig.build.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
# Prisma reads this variable while generating code; no database is contacted.
RUN DATABASE_URL=mysql://build@127.0.0.1:3306/build_only npm run prod:build

# Build separately with --target migrate; keep the CLI out of the API image.
FROM build AS migrate
ENV NODE_ENV=production
USER node
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

FROM base AS production-dependencies
COPY package.json package-lock.json ./
# Optional Prisma/TypeScript peer dependencies are build-time tools, too.
RUN npm ci --omit=dev --omit=peer --omit=optional --ignore-scripts

FROM base AS runtime
ENV NODE_ENV=production \
    LOG_LEVEL=info \
    PORT=4000
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
RUN mkdir -p logs storage/branding \
    && chown -R node:node logs storage
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
