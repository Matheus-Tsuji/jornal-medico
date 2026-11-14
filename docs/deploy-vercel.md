# Deploy na Vercel (tudo na Vercel)

Como fica em produção:

| Peça | Local | Vercel |
|---|---|---|
| Site (React) | Vite em 5173 | Arquivos estáticos da Vercel (CDN) |
| API (Fastify) | `npm run dev` em 8787 | Uma função Node (`/api/*` e `/health`), até 300 s |
| Banco | Arquivo SQLite `data/journal.db` | **Turso** (SQLite na nuvem), via `libsql` |
| Worker (fila) | `npm run worker` contínuo | **Vercel Cron** chamando `/api/v1/cron/tick` |
| Recomendador Python | Opcional | Não sobe; a API usa o recomendador em TypeScript |

O empacotamento é feito por `npm run build:vercel` (`scripts/build-vercel.mjs`), que gera `.vercel/output` no formato Build Output API v3. O `vercel.json` já manda a Vercel rodar esse comando.

## 1. Banco no Turso (uma vez)

1. Crie uma conta em turso.tech e instale a CLI (`turso auth login`).
2. Gere a cópia limpa do banco local, sem sessões, códigos de login e caixa postal de teste. Rode depois que a reanálise terminar:
   ```bash
   npm run db:export
   ```
   Isso cria `data/export-producao.db`.
3. Crie o banco a partir dessa cópia, na região mais próxima de São Paulo que o Turso oferecer:
   ```bash
   turso db create jornal-medico --from-file data/export-producao.db
   ```
   Confira o nome exato da opção na documentação da CLI do Turso, caso ela mude.
4. Pegue a URL e um token. Eles vão só para as variáveis da Vercel, nunca para o código ou o chat:
   ```bash
   turso db show jornal-medico --url
   ```
   ```bash
   turso db tokens create jornal-medico
   ```

Para começar com o banco vazio, pule o passo 2 e crie o banco sem `--from-file`. As migrações rodam sozinhas na primeira requisição, mas a semente (temas, fontes, flags, planos) precisa ser aplicada uma vez: rode `npm run db:seed` localmente com `DATABASE_URL` e `DATABASE_AUTH_TOKEN` do Turso no `.env`.

## 2. Projeto na Vercel

1. Em vercel.com, use **Add New → Project** e importe `Matheus-Tsuji/jornal-medico`.
2. Framework: **Other**. Build e install vêm do `vercel.json` (`npm ci` e `npm run build:vercel`). Não preencha o Output Directory.
3. Em **Settings → Functions → Region**, escolha a mesma região do Turso (ex.: São Paulo, `gru1`).
4. Em **Settings → Environment Variables** (Production), cadastre:

| Variável | Valor |
|---|---|
| `DATABASE_URL` | URL `libsql://…` do Turso |
| `DATABASE_AUTH_TOKEN` | Token do Turso |
| `SESSION_SECRET` | 32+ caracteres aleatórios |
| `CRON_SECRET` | 16+ caracteres aleatórios (a Vercel envia no cron) |
| `PAYMENT_WEBHOOK_SECRET` | Aleatório (obrigatório em produção, mesmo no sandbox) |
| `AUTH_EMAIL_PROVIDER` | `resend` |
| `AUTH_EMAIL_API_KEY` | Chave do Resend |
| `AUTH_EMAIL_FROM` | Remetente de um domínio verificado no Resend |
| `ADMIN_EMAILS` | E-mails da equipe editorial, separados por vírgula |
| `OPENAI_API_KEY` | **Chave nova** (revogue a que passou pelo chat) |
| `OPENAI_ANALYSIS_MODEL`, `OPENAI_EDITORIAL_MODEL`, `OPENAI_TRIAGE_MODEL` | Os mesmos do `.env` local |
| `AI_MAX_ARTICLES_PER_DAY` | Ex.: `20` |
| `NCBI_CONTACT_EMAIL` | E-mail de contato exigido pelo NCBI (`NCBI_API_KEY` é opcional) |
| `VERCEL_CRON_SCHEDULE` | Opcional. Hobby: deixe vazio (1 vez por dia, 06:00 de Brasília). Pro: `0 * * * *` |

Sem e-mail real a API não sobe em produção, e isso é proposital: no modo de teste o código de login aparece na tela, e qualquer pessoa entraria como admin. Enquanto o Resend não estiver pronto, deixe o deploy como Preview e não divulgue o link.

5. Faça o deploy. Depois:
   - `https://<seu-projeto>.vercel.app/health` deve responder `{"status":"ok"}`.
   - Entre com um e-mail de `ADMIN_EMAILS` e confira as flags em `/admin/flags`.
   - Em **Settings → Cron Jobs**, o job `/api/v1/cron/tick` deve aparecer. Dá para rodar manualmente por lá.

## 3. Como o cron trabalha

A cada execução, a função agenda as buscas no PubMed e processa a fila (busca, análise por IA, composição) por até 4 minutos. O que não couber fica para a próxima execução: os jobs têm lease e idempotência, então nada é perdido nem duplicado. No plano Hobby isso acontece uma vez por dia; no Pro, de hora em hora.

## Limitações conhecidas

- **Não testado contra um Turso e uma Vercel reais** (precisa das contas). O pacote da função foi testado localmente com o banco em arquivo: `/health`, API, edição e recusa do cron sem segredo.
- O backup local (`src/db/cli.ts backup`, via `VACUUM INTO`) não funciona com banco remoto. Use os backups e o point-in-time recovery do Turso.
- O limite de requisições é contado por instância da função, não globalmente.
- Os testes de Python e o recomendador continuam só no ambiente local e no CI.
