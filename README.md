# Calabrain

Plataforma de estudos: você organiza o material de cada assunto, faz anotações e grava uma explicação do capítulo. Na fase 2, a IA confere anotações e explicação contra os documentos-fonte e devolve notas, correções com citação e os pontos que ficaram de fora.

A interface é em inglês (v1). A especificação completa está no doc "Plataforma de Estudos — Especificação".

## Estrutura

```
apps/web       React + Vite + TanStack Router/Query + Tailwind (design system "Plataforma de Estudos")
apps/api       Fastify + Better Auth + Drizzle (Postgres)
apps/worker    Processamento em segundo plano (pg-boss), PDF e mídia nas próximas etapas
packages/shared  Schemas Zod e limites usados pelo front e pelo back
```

## Rodando localmente

Requisitos: Node 22+, pnpm 10 (`corepack enable`) e Docker.

```bash
cp .env.example .env          # gere um AUTH_SECRET: openssl rand -base64 32
pnpm install
pnpm services:up              # Postgres, MinIO (no lugar do R2) e Mailpit
pnpm db:migrate
pnpm dev                      # web em :5173, API em :3000, worker
```

- App: http://localhost:5173
- E-mails de recuperação de senha: http://localhost:8025 (Mailpit)
- Console do MinIO: http://localhost:9001 (`calabrain` / `calabrain-secret`)

## Testes

Os testes da API rodam contra um Postgres real, num banco separado (`calabrain_test`), recriado a cada execução.

```bash
docker compose exec postgres createdb -U calabrain calabrain_test   # uma vez
pnpm test
pnpm typecheck
```

Para usar outro banco: `TEST_DATABASE_URL=postgres://... pnpm test`.

## Banco de dados

O schema fica em `apps/api/src/db/schema.ts` e já contém todas as tabelas da fase 1. Depois de mudar o schema:

```bash
pnpm db:generate   # cria a migração SQL em apps/api/drizzle/
pnpm db:migrate
```

## Limites da fase 1

Definidos em `packages/shared/src/limits.ts`: PDF até 200 MB, gravação até 2 GB, duração padrão de 15 minutos por sessão (ajustável até 30), lixeira de 30 dias.

## Etapas da fase 1

1. **Base e login** — monorepo, schema completo, cadastro, login, saída e recuperação de senha (RF01). ✅
2. Árvore de Assunto, Pastas e Sessões, com lixeira (RF02–03).
3. Upload multipart para o R2, PDFs, visualizador e divisão de livro (RF04–08).
4. Editor de anotações com versões e importação (RF09–11).
5. Gravação, conversão, player e marcadores (RF12–15).
6. Status em tempo real, registro de uso, responsividade e deploy (RF16–18).
