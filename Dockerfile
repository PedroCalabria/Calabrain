# API and worker images, built from the monorepo root:
#   docker compose -f docker-compose.prod.yml up -d --build
# The web app is static and deploys to Cloudflare Pages (see README).

FROM node:22-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "@calabrain/api..." --filter "@calabrain/worker..."

FROM base AS api
ENV NODE_ENV=production
EXPOSE 3000
# Applies pending migrations, then starts the API.
CMD ["pnpm", "--filter", "@calabrain/api", "start:prod"]

FROM base AS worker
ENV NODE_ENV=production
# ffmpeg for recordings; pg_dump 16 (from the PostgreSQL apt repo) for the daily backup.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg postgresql-common ca-certificates \
  && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
  && apt-get install -y --no-install-recommends postgresql-client-16 \
  && rm -rf /var/lib/apt/lists/*
CMD ["pnpm", "--filter", "@calabrain/worker", "start"]
