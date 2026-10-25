# Calabrain — notes for Claude

- pnpm workspaces monorepo: `apps/web`, `apps/api`, `apps/worker`, `packages/shared`. TypeScript everywhere, ESM, `.ts` extensions in relative imports.
- UI copy is English, sentence case, no exclamation marks; follow the "Plataforma de Estudos" design system (tokens live in `apps/web/src/styles/app.css`). One primary button per screen.
- API rules: every resource is filtered by the owner; another user's resource answers 404 (`notFound()` in `apps/api/src/lib/errors.ts`), never 403. Errors use the `ApiError` body from `@calabrain/shared`.
- Validation schemas and product limits live in `packages/shared` and are used by both web and API.
- Schema changes: edit `apps/api/src/db/schema.ts`, then `pnpm db:generate` (never hand-edit generated migrations).
- API tests hit a real Postgres (`TEST_DATABASE_URL`, default `calabrain_test`); run `pnpm test` and `pnpm typecheck` before committing.
