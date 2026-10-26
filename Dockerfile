# API and worker images, built from the monorepo root:
#   docker compose -f docker-compose.prod.yml up -d --build
# The web app is static. On Cloudflare Pages it builds there; to serve it from the VPS instead,
# export the built files with the "web" target (see docs/deploy-vps.md):
#   docker build --target web --build-arg VITE_API_URL=https://api.example --output type=local,dest=<folder> .

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

# --- Web app as static files (no runtime image: use with --output).
FROM node:22-bookworm-slim AS web-build
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "@calabrain/web..."
ARG VITE_API_URL
RUN test -n "$VITE_API_URL" || (echo "Pass --build-arg VITE_API_URL=https://api.your-domain" && exit 1)
RUN pnpm --filter @calabrain/web build

FROM scratch AS web
COPY --from=web-build /app/apps/web/dist/ /
