# Deploy numa VPS com CloudPanel

Passo a passo para colocar o Calabrain no ar numa VPS que já roda outros sites pelo CloudPanel (por exemplo, a VPS da Hostinger com WordPress). O Calabrain fica ao lado do WordPress sem mexer nele.

**Onde fica cada parte**

| Parte | Onde | Endereço sem domínio próprio |
| --- | --- | --- |
| App (React, arquivos estáticos) | Site estático no CloudPanel | `https://calabrain.<IP>.sslip.io` |
| API | Docker na VPS, atrás de um proxy reverso do CloudPanel | `https://api.calabrain.<IP>.sslip.io` |
| Worker e Postgres | Docker na VPS, sem porta aberta | — |
| PDFs, gravações e backups | Cloudflare R2 | — |

`<IP>` é o IPv4 da VPS, com pontos (ex.: `calabrain.203.0.113.10.sslip.io`). O [sslip.io](https://sslip.io) é um DNS gratuito: qualquer nome que contenha um IP aponta para esse IP, e o CloudPanel consegue emitir o certificado HTTPS (Let's Encrypt) para ele. O nome da VPS (`srvXXXX.hstgr.cloud`) não serve, porque pertence à Hostinger: não dá para criar subdomínios nele.

App e API precisam ficar sob o mesmo nome de base (aqui, `...<IP>.sslip.io`; com domínio próprio, `app.` e `api.` do mesmo domínio). É isso que faz o cookie de login funcionar, inclusive no Safari do iPhone.

Tempo estimado: 1 hora.

---

## 1. Preparar a VPS

Entre por SSH (usuário e IP no painel da Hostinger, em *Detalhes do VPS*).

Veja se há memória swap. Ela evita que o build das imagens derrube algo por falta de memória:

```bash
free -h
```

Se a linha `Swap` mostrar `0B`, crie 2 GB:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Instale o Docker (script oficial; instala também o `docker compose`):

```bash
curl -fsSL https://get.docker.com | sh
docker compose version
```

O Docker não usa as portas 80 e 443, que continuam com o CloudPanel. O Postgres não abre porta nenhuma e a API escuta só em `127.0.0.1:3000`, ou seja, nada do Calabrain fica exposto diretamente na internet.

## 2. Baixar o código

O repositório é privado, então a VPS precisa de uma chave de leitura (*deploy key*):

```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/calabrain_deploy
cat ~/.ssh/calabrain_deploy.pub
```

No GitHub, abra o repositório → *Settings* → *Deploy keys* → *Add deploy key*. Cole a chave, deixe **sem** permissão de escrita e salve. Depois:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github-calabrain
  HostName github.com
  IdentityFile ~/.ssh/calabrain_deploy
EOF
git clone git@github-calabrain:PedroCalabria/Calabrain.git /opt/calabrain
cd /opt/calabrain
```

## 3. Cloudflare R2

No painel da Cloudflare → *R2 Object Storage*:

1. **Bucket**: *Create bucket*, nome `calabrain`, acesso privado (o padrão).
2. **CORS**: bucket → *Settings* → *CORS policy* → *Add CORS policy* e cole, trocando `<IP>`:
   ```json
   [
     {
       "AllowedOrigins": ["https://calabrain.<IP>.sslip.io"],
       "AllowedMethods": ["GET", "PUT", "HEAD"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
3. **Ciclo de vida**: bucket → *Settings* → *Object lifecycle rules* → *Add rule*: abortar uploads multipart incompletos após 1 dia.
4. **Chave de acesso**: na página do R2, *Manage API tokens* → *Create API token* → permissão *Object Read & Write*, limitada ao bucket `calabrain`. A Cloudflare mostra o *Access Key ID* e o *Secret Access Key* uma única vez: copie direto para o `.env` do passo 5.

O endpoint é o *S3 API* da conta: `https://<account-id>.r2.cloudflarestorage.com` (sem o nome do bucket no final).

## 4. E-mail (recuperação de senha)

Não precisa de serviço pago. Para uso pessoal, o SMTP do Gmail resolve:

1. Ative a verificação em duas etapas na conta Google.
2. Crie uma senha de app em <https://myaccount.google.com/apppasswords> (nome: "Calabrain").
3. Use os 16 caracteres, sem espaços, em `SMTP_PASS`.

O Gmail permite algumas centenas de e-mails por dia, bem mais do que a recuperação de senha vai usar. Serviços como Resend ou Brevo também têm plano gratuito, mas pedem um domínio próprio verificado; ficam para quando houver domínio.

## 5. Configurar o `.env`

```bash
cd /opt/calabrain
cp .env.example .env
chmod 600 .env
openssl rand -base64 32   # AUTH_SECRET
openssl rand -hex 24      # POSTGRES_PASSWORD (só letras e números)
nano .env
```

Preencha (troque `<IP>`, o e-mail e as chaves):

```dotenv
NODE_ENV=production
POSTGRES_PASSWORD=<saída do openssl rand -hex 24>

API_URL=https://api.calabrain.<IP>.sslip.io
WEB_URL=https://calabrain.<IP>.sslip.io
AUTH_SECRET=<saída do openssl rand -base64 32>
SIGNUP_ENABLED=true

SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=seu-email@gmail.com
SMTP_PASS=<senha de app>
MAIL_FROM="Calabrain <seu-email@gmail.com>"

S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=calabrain
S3_ACCESS_KEY_ID=<Access Key ID>
S3_SECRET_ACCESS_KEY=<Secret Access Key>
S3_FORCE_PATH_STYLE=false

VITE_API_URL=https://api.calabrain.<IP>.sslip.io
WEB_DIR=/home/calabrain/htdocs/calabrain.<IP>.sslip.io
```

`DATABASE_URL` pode ficar como está: o `docker-compose.prod.yml` define o endereço do banco dentro do Docker. `WEB_DIR` é a pasta do site estático do passo 8 (o script de atualização publica o app nela).

**Limite de CPU do worker.** Converter um vídeo do iPhone usa todo o processador disponível. Por padrão, o worker usa no máximo 75% de um núcleo e perde a disputa para qualquer outro processo, então o WordPress continua rápido enquanto um vídeo converte (a conversão demora mais, e o status aparece no app). Para mudar, use `WORKER_CPUS` (ex.: `1.5` numa VPS de 2 núcleos) e `WORKER_MEMORY`.

## 6. Subir API, worker e banco

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

O primeiro build leva alguns minutos num núcleo só. A API aplica as migrações do banco ao iniciar. Confira:

```bash
docker compose -f docker-compose.prod.yml ps        # três serviços "running"
curl -s http://127.0.0.1:3000/health                # {"ok":true}
docker compose -f docker-compose.prod.yml logs worker | tail -5   # "[worker] ready, waiting for jobs"
```

## 7. Site da API no CloudPanel

1. *Sites* → *Add Site* → *Create a Reverse Proxy*.
2. Domínio: `api.calabrain.<IP>.sslip.io`. Reverse Proxy URL: `http://127.0.0.1:3000`. Crie o usuário do site que o CloudPanel pedir.
3. No site → *SSL/TLS* → *Actions* → *New Let's Encrypt Certificate* → *Create and Install*.
4. No site → *Vhost*: dentro do bloco `server { ... }` que tem `listen 443`, logo antes do `location / {`, cole o trecho abaixo e salve. Ele mantém aberta a conexão dos status em tempo real (documento processado, vídeo convertido):
   ```nginx
   location /events {
     proxy_pass http://127.0.0.1:3000;
     proxy_http_version 1.1;
     proxy_set_header Host $host;
     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
     proxy_set_header X-Forwarded-Proto $scheme;
     proxy_set_header Connection "";
     proxy_buffering off;
     proxy_cache off;
     proxy_read_timeout 1h;
   }
   ```

Teste no navegador: `https://api.calabrain.<IP>.sslip.io/health` deve mostrar `{"ok":true}`.

## 8. Site do app no CloudPanel

1. *Sites* → *Add Site* → *Create a Static HTML Site*.
2. Domínio: `calabrain.<IP>.sslip.io`. Usuário do site: `calabrain` (se usar outro nome, ajuste o `WEB_DIR` no `.env`).
3. *SSL/TLS* → *New Let's Encrypt Certificate*, como no passo 7.
4. *Vhost*: o modelo de site estático não tem `location /`. Adicione este bloco logo depois de `index index.html;` e salve. Sem ele, as rotas do app (como `/notes/...`) dão 404 quando abertas por um link ou ao recarregar a página:
   ```nginx
   location / {
     try_files $uri $uri/ /index.html;
   }
   ```
5. Gere e publique o app:
   ```bash
   cd /opt/calabrain
   ./scripts/deploy.sh
   ```
   O script atualiza o código, reconstrói API e worker e publica o app no `WEB_DIR`. Rode o mesmo comando sempre que houver atualização.

## 9. Primeiro acesso

1. Abra `https://calabrain.<IP>.sslip.io` e crie a sua conta.
2. Feche o cadastro para mais ninguém criar conta e usar o seu armazenamento: no `.env`, troque para `SIGNUP_ENABLED=false` e rode `docker compose -f docker-compose.prod.yml up -d`.
3. Teste o essencial:
   - **Recuperação de senha**: saia, use *Forgot password* e confira se o e-mail chega (veja também o spam).
   - **PDF**: envie um PDF pequeno e veja o status mudar para pronto sem recarregar a página.
   - **Gravação**: envie um vídeo curto do celular e abra o player depois da conversão.

Se algo falhar, os logs mostram o motivo:

```bash
docker compose -f docker-compose.prod.yml logs --tail 100 api
docker compose -f docker-compose.prod.yml logs --tail 100 worker
```

Erro de upload no navegador (CORS) quase sempre é a origem na regra de CORS do R2 diferente do endereço do app (com `https://`, sem barra no final).

## 10. Manutenção

- **Atualizar**: `cd /opt/calabrain && ./scripts/deploy.sh`.
- **Backup**: o worker salva o banco no R2 (`backups/`) todo dia às 04:07, mantendo os 14 mais recentes. Para restaurar, baixe o arquivo do R2 para a VPS e rode:
  ```bash
  gunzip -c calabrain-<data>.sql.gz | docker compose -f docker-compose.prod.yml exec -T postgres psql -U calabrain calabrain
  ```
- **Espaço em disco**: `docker system df` mostra o que o Docker ocupa. O script já apaga as imagens antigas a cada atualização.
- **Reiniciar tudo**: `docker compose -f docker-compose.prod.yml restart`. Os containers também voltam sozinhos depois de um reboot da VPS.

## Quando tiver um domínio próprio

Com um domínio (ex.: `calabrain.com.br`), o app pode ir para o Cloudflare Pages e sair da VPS:

1. Coloque o DNS do domínio na Cloudflare e crie o registro `api` (tipo A, apontando para o IP da VPS).
2. No CloudPanel, crie o proxy reverso do passo 7 para `api.seu-dominio` (com o trecho de `/events`).
3. No Cloudflare Pages, conecte o repositório:
   - comando de build: `pnpm --filter @calabrain/web build`;
   - pasta de saída: `apps/web/dist`;
   - variável: `VITE_API_URL=https://api.seu-dominio`;
   - domínio: `app.seu-dominio`.

   O arquivo `_redirects` já cuida das rotas.
4. No `.env`, troque `API_URL` e `WEB_URL`, apague `WEB_DIR` e rode `./scripts/deploy.sh`. Atualize a origem na regra de CORS do R2.
5. Com o domínio, dá para trocar o Gmail por um serviço com remetente próprio (ex.: `no-reply@seu-dominio`).

Quem estiver logado vai precisar entrar de novo, porque o cookie pertence ao endereço antigo.
