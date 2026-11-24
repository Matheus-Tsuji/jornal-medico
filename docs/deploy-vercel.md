# Deploy na Vercel (tudo na Vercel)

## Como está agora (sem nenhuma configuração)

O site já funciona na Vercel sem variáveis: a API usa a **vitrine** (`apps/server/data/vitrine.db`, gerada com `npm run db:export -w @jm/server -- --vitrine`, sem nenhum dado de pessoa), e os segredos são gerados e guardados no banco. Visitantes leem, escolhem interesses e salvam estudos, mas isso pode se perder quando a instância da função recicla (o site avisa). O login por e-mail fica "ainda não disponível" e o cron não roda na vitrine. Para atualizar a vitrine com análises novas, gere de novo e faça commit.

## Caminho rápido (dados permanentes)

Para o que os leitores salvam não se perder, ligue o Turso:

1. **Banco:** no painel do projeto, abra **Storage → Create Database → Turso** (Marketplace) e conecte ao projeto `jornal-medico`. A integração cria sozinha `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN`, e a API já lê esses nomes.
2. **Dados:** copie esses dois valores para o `.env` local como `PUSH_DATABASE_URL` e `PUSH_DATABASE_AUTH_TOKEN` e rode:
   ```bash
   npm run db:export
   ```
   ```bash
   npm run db:push
   ```
   Isso sobe a cópia limpa do banco local (análises, temas, Qualis, flags), sem sessões nem códigos de login.
3. **Segredos (recomendado):** sem eles a API gera e guarda os segredos no próprio banco, mas aí um vazamento do banco expõe também o segredo. Gere três valores aleatórios (rode o comando três vezes) e cadastre em Settings → Environment Variables como `SESSION_SECRET`, `PAYMENT_WEBHOOK_SECRET` e `CRON_SECRET` (este último é obrigatório para o cron rodar):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
4. **Redeploy** em Deployments → ⋯ → Redeploy.

Com isso, "Continuar sem e-mail" funciona. O login por código aparece como "ainda não disponível" até o Resend ser configurado (variáveis `AUTH_EMAIL_*`); em produção o código nunca é mostrado na tela. A análise automática pelo cron precisa também das variáveis da OpenAI.

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

1. O projeto **já foi criado** em 2026-11-14 e está ligado ao repositório (todo push no `main` vira deploy de produção): https://vercel.com/budegasdobode-2590s-projects/jornal-medico
2. Framework: **Other**. Build e install vêm do `vercel.json` (`npm ci` e `npm run build:vercel`). Não preencha o Output Directory.
3. Em **Settings → Functions → Region**, escolha a mesma região do Turso (ex.: São Paulo, `gru1`).
4. Em **Settings → Environment Variables** (Production), cadastre:

| Variável | Valor |
|---|---|
| NODE_ENV | production no runtime da Vercel |
| DATABASE_URL | URL `libsql://…` do Turso |
| `DATABASE_AUTH_TOKEN` | Token do Turso |
| `SESSION_SECRET` | 32+ caracteres aleatórios |
| `CRON_SECRET` | 16+ caracteres aleatórios (a Vercel envia no cron) |
| `PAYMENT_WEBHOOK_SECRET` | Aleatório (obrigatório em produção com Turso; na vitrine pode ser gerado localmente) |
| `AUTH_EMAIL_PROVIDER` | `resend` |
| `AUTH_EMAIL_API_KEY` | Chave do Resend |
| `AUTH_EMAIL_FROM` | Remetente de um domínio verificado no Resend |
| `ADMIN_EMAILS` | E-mails da equipe editorial, separados por vírgula |
| `OPENAI_API_KEY` | **Chave nova** (revogue a que passou pelo chat) |
| `OPENAI_ANALYSIS_MODEL`, `OPENAI_EDITORIAL_MODEL`, `OPENAI_TRIAGE_MODEL` | Os mesmos do `.env` local |
| `AI_MAX_ARTICLES_PER_DAY` | Ex.: `20` |
| `NCBI_CONTACT_EMAIL` | E-mail de contato exigido pelo NCBI (`NCBI_API_KEY` é opcional) |
| `VERCEL_CRON_SCHEDULE` | Opcional. Hobby: deixe vazio (1 vez por dia, 06:00 de Brasília). Pro: `0 * * * *` |

Sem e-mail real, a API sobe só com acesso de visitante: o pedido de código responde "ainda não disponível" e o código nunca aparece na tela (se aparecesse, qualquer pessoa entraria como admin). Sem login, ninguém acessa o painel editorial na produção até o Resend estar pronto.

5. Faça o deploy. Depois:
   - `https://<seu-projeto>.vercel.app/health` deve responder `{"status":"ok"}`.
   - /ready deve responder pela API e confirmar a consulta ao banco.
   - Entre com um e-mail de `ADMIN_EMAILS` e confira as flags em `/admin/flags`.
   - Em **Settings → Cron Jobs**, o job `/api/v1/cron/tick` deve aparecer. Dá para rodar manualmente por lá.

## 3. Ciclo diário (retroalimentação automática)

Cada execução do cron chama `runCycle` (`apps/server/src/worker/runner.ts`), o mesmo ciclo do worker local e de `npm run pipeline -- cycle`:

1. **Agenda** (idempotente por data e janela de 6 h): busca no PubMed, Europe PMC e SciELO via Crossref para os temas configurados, monitor de documentos oficiais, recheck de retratações dos últimos 180 dias e composição da edição.
2. **Busca** pela data de entrada no PubMed (`edat`), lendo a janela inteira desde o último cursor, com 3 dias de sobreposição (`INGEST_MAX_PER_TOPIC`, padrão 200). Estudos publicados há meses e indexados agora entram. Se uma janela vier maior que o limite, isso fica registrado na busca, em vez de se perder em silêncio.
3. **Analisa** os elegíveis em paralelo (`CYCLE_CONCURRENCY`, padrão 8; em 2026-11-16 foram 82 análises em cerca de 8 min, sem limite de taxa da OpenAI), respeitando `AI_MAX_ARTICLES_PER_DAY`. O que passa do limite do dia, ou chega enquanto a IA ainda não está configurada, é **adiado** (sem gastar tentativa) e entra sozinho no próximo ciclo. Análises que passam de 14 dias na fila por padrão expiram e podem ser reenfileiradas pelo painel.
4. **Entrega**: a capa (prévia) abre com o que o ciclo trouxe nas últimas 36 h, os mais bem avaliados primeiro, e mostra "N novos nas últimas 36 h". Publicar uma edição oficial continua exigindo editor humano.

Na Vercel, o ciclo para de pegar trabalho novo aos 115 s (a função vai até 300 s). O que sobra continua na próxima execução, com lease e idempotência: nada é perdido nem duplicado. No plano Hobby o cron roda 1 vez por dia; no Pro, `VERCEL_CRON_SCHEDULE="0 * * * *"` faz de hora em hora.

**Requisitos para o ciclo rodar na Vercel:** banco permanente (Turso), `CRON_SECRET` e as variáveis da OpenAI. Na vitrine o cron responde `409 needs_database`, porque o que ele buscasse se perderia.

## Limitações conhecidas

- **Não testado contra um Turso e uma Vercel reais** (precisa das contas). O pacote da função foi testado localmente com o banco em arquivo: `/health`, API, edição e recusa do cron sem segredo.
- O backup local (`src/db/cli.ts backup`, via `VACUUM INTO`) não funciona com banco remoto. Use os backups e o point-in-time recovery do Turso.
- O limite HTTP geral é por instância. Autenticação e espaçamento das fontes científicas compartilham o banco quando há Turso. Cada cópia da vitrine tem seus próprios limites.
- Sessões de visitante da vitrine têm expiração assinada. A revogação é local à cópia efêmera; outra instância pode recriar a sessão até esse horário.
- Migrações revalidam a versão sob transação imediata e podem ser executadas separadamente com `npm run db:migrate`. A API síncrona de transação do libSQL usa o mesmo `BEGIN IMMEDIATE`; contenção, latência e semântica com múltiplas instâncias precisam ser confirmadas em um Turso de teste.
- Os testes de Python e o recomendador continuam só no ambiente local e no CI.
