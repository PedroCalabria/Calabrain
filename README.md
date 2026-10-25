# Calabrain

Plataforma de estudos: você organiza o material de cada assunto, faz anotações e grava uma explicação do capítulo. Na fase 2, a IA confere anotações e explicação contra os documentos-fonte e devolve notas, correções com citação e os pontos que ficaram de fora.

A interface é em inglês (v1). A especificação completa está no doc "Plataforma de Estudos — Especificação".

## Estrutura

```
apps/web       React + Vite + TanStack Router/Query + Tailwind (design system "Plataforma de Estudos")
apps/api       Fastify + Better Auth + Drizzle (Postgres)
apps/worker    Processamento em segundo plano (pg-boss): texto e sumário de PDFs, capítulos, limpeza diária da lixeira
packages/db    Schema Drizzle, migrações e regras da lixeira (usado pela API e pelo worker)
packages/storage  Cliente S3/R2 (upload multipart, URLs pré-assinadas)
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

## Armazenamento de arquivos (R2)

Os arquivos sobem do navegador direto para o bucket, em partes de 10 MB, por URLs pré-assinadas pela API; o bucket é privado. Em produção, crie no Cloudflare R2 um bucket privado e uma chave de API com acesso de leitura e escrita a ele, e preencha `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, `S3_REGION=auto`, `S3_FORCE_PATH_STYLE=false`, `S3_BUCKET` e as chaves no `.env` do servidor.

O bucket precisa de uma regra de CORS para o navegador enviar e ler os arquivos (R2 → bucket → Settings → CORS policy):

```json
[
  {
    "AllowedOrigins": ["https://app.seu-dominio"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"],
    "MaxAgeSeconds": 3600
  }
]
```

Adicione também uma regra de ciclo de vida que aborta uploads multipart incompletos após 1 dia.

## Testes

Os testes rodam contra um Postgres real (bancos `calabrain_test` e `calabrain_worker_test`, recriados a cada execução) e um servidor S3 de teste na porta 9100 (`moto_server`, o mesmo do CI):

```bash
docker compose exec postgres createdb -U calabrain calabrain_test   # uma vez
pip install "moto[server]" && moto_server -p 9100 &                  # S3 de teste
pnpm test
pnpm typecheck
```

Para usar outro banco: `TEST_DATABASE_URL=postgres://... pnpm test`.

## Banco de dados

O schema fica em `packages/db/src/schema.ts` e já contém todas as tabelas da fase 1. Depois de mudar o schema:

```bash
pnpm db:generate   # cria a migração SQL em packages/db/drizzle/
pnpm db:migrate
```

## Limites da fase 1

Definidos em `packages/shared/src/limits.ts`: PDF até 200 MB, gravação até 2 GB, duração padrão de 15 minutos por sessão (ajustável até 30), lixeira de 30 dias.

## Etapas da fase 1

1. **Base e login** — monorepo, schema completo, cadastro, login, saída e recuperação de senha (RF01). ✅
2. **Árvore** — Assunto, Pastas e Sessões, mover e reordenar, lixeira de 30 dias com restauração em cascata (RF02–03). ✅
3. **Documentos** — upload multipart direto para o R2 com retomada, extração de texto e sumário, deduplicação, visualizador e divisão de livro em sessões (RF04–08). ✅
4. Editor de anotações com versões e importação (RF09–11).
5. Gravação, conversão, player e marcadores (RF12–15).
6. Status em tempo real, registro de uso, responsividade e deploy (RF16–18).
