# Jornal Médico (nome provisório)

Jornal diário de atualização médica baseado em evidências: estudos selecionados de fontes autorizadas, resumo em português, números como foram reportados (medida, IC, p), limitações, rastreabilidade e link original. Sem anúncios, sem feed infinito, sem rede social.

> Estado: **MVP beta funcional em ambiente local**. Leitores veem uma **edição de demonstração com estudos fictícios** (marcados em todas as telas) até a flag `real_content` ser ligada. Ingestão real do PubMed funciona; análise por IA exige `OPENAI_API_KEY`. Detalhes em [PROGRESS.md](PROGRESS.md).

## Requisitos
- Node.js **24+** (usa `node:sqlite` nativo) e npm 11
- Python 3.11+ com `scikit-learn` e `pytest` (só para o recomendador opcional)

## Rodar localmente
```bash
npm install
```
```bash
cp .env.example .env
```
Edite `.env` e coloque seu e-mail em `ADMIN_EMAILS` para entrar como admin.
```bash
npm run db:seed
```
```bash
npm run dev
```
- Web: http://localhost:5173 (Vite, com proxy para a API)
- API: http://localhost:8787 (`/api/v1`, OpenAPI em `/api/v1/openapi.json`, saúde em `/health` e `/ready`)
- Login: digite o e-mail. **Sem provedor de e-mail configurado (modo de teste), o código aparece na própria tela** e na caixa postal local (`/dev/caixa`); nenhum e-mail real é enviado. Para enviar e-mails de verdade: `AUTH_EMAIL_PROVIDER=resend`, `AUTH_EMAIL_API_KEY` e `AUTH_EMAIL_FROM` (domínio verificado no Resend).
- Ou **“Continuar sem e-mail”**: acesso de visitante; dá para informar o e-mail depois sem perder interesses e salvos.

Worker (agendamento e fila de ingestão/análise):
```bash
npm run worker
```
Recomendador Python opcional (depois defina `RECOMMENDER_URL=http://127.0.0.1:8790`):
```bash
python services/recommender/serve.py --port 8790
```

## Configurar a IA (OpenAI)
1. Coloque `OPENAI_API_KEY=...` no `.env` (nunca no código, no chat ou em notas).
2. Liste os modelos que o seu projeto pode usar:
```bash
npm run ai -- models
```
3. Defina `OPENAI_ANALYSIS_MODEL` e `OPENAI_EDITORIAL_MODEL` no `.env` com IDs dessa lista e teste a conexão:
```bash
npm run ai -- ping
```
4. Preencha `apps/server/config/ai-pricing.json` com os preços oficiais (por 1 milhão de tokens) para o painel calcular custos.

## Pipeline manual
```bash
npm run pipeline -- discover hipertensao-arterial
```
```bash
npm run pipeline -- run
```
```bash
npm run pipeline -- compose 2026-11-14
```
`discover` consulta o PubMed (E-utilities), deduplica, faz a triagem e enfileira análises. `run` processa a fila. Sem `OPENAI_API_KEY` as análises ficam **bloqueadas** (não falham em loop e nada é inventado). Com chave, a análise vai para a fila editorial em `/admin/revisao`; a edição é composta e publicada por um editor em `/admin/edicoes`.

## Testes e verificações
```bash
npm run check
```
Roda lint (ESLint), typecheck (tsc estrito), testes do servidor (Vitest), testes Python (pytest) e build.
```bash
npm run test:e2e
```
Playwright contra o build de produção num banco descartável (porta 8799). Se o Playwright pedir outra versão do navegador, aponte um Chromium já instalado com `PW_CHROMIUM=<caminho do chrome-headless-shell.exe>`.

Backup consistente do SQLite (inclui WAL) e verificação de restore:
```bash
npm run db:backup -w @jm/server
```

## Estrutura
```
apps/server   API Fastify + worker (mesmo pacote, dois processos): db, módulos, IA, fontes, jobs
apps/web      React + Vite + Tailwind v4 + React Router + TanStack Query
packages/contracts  schemas zod e tipos compartilhados (inclui o schema estrito da IA)
services/recommender  ranking em Python (scikit-learn), servidor stdlib, avaliação offline
tests/e2e     Playwright
docs/         arquitetura, pressupostos, referências, pendências dos fundadores, capturas
```

Documentos: [arquitetura](docs/architecture.md) · [pressupostos](docs/assumptions.md) · [referências de design](docs/references.md) · [decisões pendentes](docs/pendencias-fundadores.md) · [regras do projeto](AGENTS.md).
