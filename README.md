# Calabrain

Plataforma de estudos: você organiza o material de cada assunto, faz anotações e grava uma explicação do capítulo. Na fase 2, a IA confere anotações e explicação contra os documentos-fonte e devolve notas, correções com citação e os pontos que ficaram de fora.

A interface é em inglês (v1). A especificação completa está no doc "Plataforma de Estudos — Especificação".

## Estrutura

```
apps/web       React + Vite + TanStack Router/Query + Tailwind (design system "Plataforma de Estudos")
apps/api       Fastify + Better Auth + Drizzle (Postgres)
apps/worker    Processamento em segundo plano (pg-boss): PDFs e capítulos, gravações (ffmpeg), importação de anotações, versões de rascunhos parados, limpeza diária da lixeira
packages/db    Schema Drizzle, migrações e regras da lixeira (usado pela API e pelo worker)
packages/storage  Cliente S3/R2 (upload multipart, URLs pré-assinadas)
packages/editor  Schema das anotações (TipTap) e conversões de importação
packages/shared  Schemas Zod e limites usados pelo front e pelo back
```

## Rodando localmente

Requisitos: Node 22+, pnpm 10 (`corepack enable`), Docker e ffmpeg (o worker converte as gravações).

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

## Deploy

**API e worker na VPS** (Docker Compose), **web no Cloudflare Pages**, **arquivos no R2**.

1. **Servidor**: clone o repositório na VPS, copie `.env.example` para `.env` e preencha para produção:
   - `NODE_ENV=production`, `POSTGRES_PASSWORD` (só letras e números, porque entra na URL do banco), `AUTH_SECRET` (`openssl rand -base64 32`);
   - `API_URL=https://api.seu-dominio` e `WEB_URL=https://app.seu-dominio` (os dois no mesmo domínio, para o cookie de sessão funcionar);
   - SMTP do provedor de e-mail e `MAIL_FROM`;
   - as variáveis `S3_*` do R2 (veja "Armazenamento de arquivos").
2. Suba tudo: `docker compose -f docker-compose.prod.yml up -d --build`. A API aplica as migrações ao iniciar e escuta só em `127.0.0.1:3000`.
3. **Proxy reverso com HTTPS** para `api.seu-dominio` → `http://127.0.0.1:3000` (no CloudPanel: *Add Site → Reverse Proxy*). Para os status em tempo real, desligue o buffering em `/events`:
   ```nginx
   location /events { proxy_pass http://127.0.0.1:3000; proxy_buffering off; proxy_read_timeout 1h; }
   ```
   Aumente também o limite de corpo só se for usar uploads pela API (não é o caso: os arquivos vão direto ao R2).
4. **Web no Cloudflare Pages**: conecte o repositório, comando de build `pnpm --filter @calabrain/web build`, pasta de saída `apps/web/dist`, variável `VITE_API_URL=https://api.seu-dominio` e domínio `app.seu-dominio`. O arquivo `_redirects` já manda todas as rotas para o app.
5. **Atualizar**: `git pull && docker compose -f docker-compose.prod.yml up -d --build`.

**Backup**: o worker roda `pg_dump` todo dia às 04:07 (horário de Brasília) e guarda no bucket em `backups/`, mantendo os 14 mais recentes. Para restaurar: baixe o arquivo do R2 e rode `gunzip -c calabrain-<data>.sql.gz | docker compose -f docker-compose.prod.yml exec -T postgres psql -U calabrain calabrain`.

**Rotinas do worker**: limpeza da lixeira e de uploads abandonados (todo dia às 03:17), versões de rascunhos parados (a cada 5 minutos) e backup (04:07).

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
4. **Anotações** — editor (TipTap) com rascunho contínuo, versões imutáveis, conflito entre abas (409), histórico e restauração, importação de .txt, .md, .docx e PDF (RF09–11). ✅
5. **Gravações** — tentativas com limite de duração (checado no navegador e no worker), substituição, conversão para MP4 H.264, áudio extraído e miniatura, player com velocidade e marcadores, página da sessão no layout aprovado (RF12–15). ✅
6. **Tempo real e deploy** — status por Server-Sent Events (com polling de reserva), registro e painel de uso, revisão de responsividade, Docker Compose de produção, backup diário e limpeza de uploads (RF16–18). ✅
