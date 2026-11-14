# Pressupostos e decisões de implementação

Versão 1.0 — 2026-11-14. Cada item é um default reversível do briefing (seção 2.2) ou uma adaptação técnica. O que depende dos fundadores está em [pendencias-fundadores.md](pendencias-fundadores.md).

## Produto
- Nome provisório **Jornal Médico**, configurável por `VITE_BRAND_NAME` (só texto público, nunca segredo).
- MVP com **Clínica médica** ativa e três temas habilitados: hipertensão, diabetes, insuficiência cardíaca. As outras quatro áreas estão modeladas na taxonomia, com `enabled = 0`, e aparecem como "em preparação" sem conteúdo simulado.
- Edição diária às 06:00 em `America/Sao_Paulo` (`EDITION_HOUR`, `APP_TIMEZONE`). O worker gera um **rascunho**; a publicação exige um editor (beta com revisão humana).
- `FEATURE_REAL_CONTENT=false` (default): o leitor vê apenas a edição de demonstração, marcada em todas as telas. Conteúdo real ingerido fica no painel editorial até a flag ser ligada.
- **Acesso de visitante** ("Continuar sem e-mail"): conta sem e-mail ligada a uma sessão do navegador. Ao confirmar um e-mail depois, a conta é convertida (ou mesclada a uma conta existente) sem perder interesses e salvos. Visitante não assina. Limite de 10 visitantes/hora por IP.
- **Modo de teste de e-mail**: sem provedor configurado, o código aparece na própria tela de login. Bloqueado em produção (exige provedor real).
- Login sem senha por **código de 6 dígitos (OTP)** enviado por e-mail. Escolhido em vez de magic link porque funciona quando o e-mail é aberto em outro aparelho e não depende de links clicáveis em clientes corporativos.
- Paywall desligado por padrão (`PAYWALL_ENABLED=false`). Quando ligado, a análise aprofundada exige assinatura `active`/`trialing` (ou carência de `past_due` dentro de `BILLING_GRACE_DAYS`).
- Preços: Beta R$ 49,90 (ativo) e Referência R$ 99,90 (inativo), em centavos, editáveis no admin. Apenas sandbox.

## Técnica
- **Monorepo npm workspaces** (`apps/server`, `apps/web`, `packages/contracts`, `services/recommender`). A API e o worker ficam no mesmo pacote (`apps/server`) com dois pontos de entrada (`src/api/main.ts`, `src/worker/main.ts`), compartilhando módulos e repositórios — o briefing permite. Menos pacotes = menos build e versões para manter.
- **Banco: SQLite nativo do Node 24 (`node:sqlite`)** + migrações SQL versionadas, sem ORM. Motivo: zero compilação nativa no Windows, SQL explícito e portável. Todas as consultas são parametrizadas. Caminho para PostgreSQL em [architecture.md](architecture.md#sqlite--postgresql).
- **OpenAI via HTTP oficial da Responses API** (`POST /v1/responses`, `text.format` = `json_schema` estrito), sem SDK: a versão atual do SDK (7.x) é posterior ao conhecimento do autor e não quisemos inventar sua API. O contrato HTTP é estável e documentado.
- Modelos escolhidos em 2026-11-14 a partir do catálogo do projeto e da documentação oficial: análise `gpt-6.1-sol` (US$ 2 / 0,10 / 10 por 1M tokens entrada/cache/saída), redação `gpt-6.1-terra` (1 / 0,05 / 5), triagem `gpt-6-luna` (0,10 / 0,01 / 0,50). Configurados só no `.env`.
- Nenhum ID de modelo é fixado no código: `OPENAI_TRIAGE_MODEL`, `OPENAI_ANALYSIS_MODEL`, `OPENAI_EDITORIAL_MODEL` são obrigatórios quando `OPENAI_API_KEY` existe. Preços de modelo ficam em `apps/server/config/ai-pricing.json`, vazio até alguém preencher com a tabela oficial; sem preço, o custo aparece como "não configurado" (tokens continuam registrados).
- Fila de jobs persistente em SQLite com lease, idempotência e backoff com jitter. Redis/BullMQ apenas quando houver gargalo medido.
- Recomendação: baseline determinístico em TypeScript (sempre disponível) + serviço Python opcional (`RECOMMENDER_URL`). Se o Python falhar ou demorar mais de 800 ms, o baseline responde.
- Lint = ESLint (typescript-eslint) + `tsc --noEmit` estrito.
- E-mail: provedor `console` em desenvolvimento (grava na caixa postal local `dev_outbox`, visível em `/dev/caixa`); provedor `resend` implementado por HTTP, **não testado ao vivo**.
- Git: o repositório não foi inicializado; versionamento depende de autorização do Matheus.

## Ciência e licenças
- PubMed é a única fonte com adaptador real no MVP. Triagem: regras determinísticas e depois IA barata (`OPENAI_TRIAGE_MODEL`) que exclui artigos em que o tema só aparece de passagem (ex.: hipertensão pulmonar numa busca de hipertensão arterial). Europe PMC, Crossref, SciELO e sociedades estão cadastradas como fontes `planned` (sem adaptador ativo).
- O abstract do PubMed é guardado **apenas para análise interna e revisão editorial**, com licença marcada como `abstract-copyright-unverified`. O leitor nunca vê o abstract integral; vê nossa síntese e o link original. A validação jurídica do uso comercial está pendente.
- Toda análise real nasce `in_review`. Publicação exige editor com papel `editor`/`admin`, registrado com identidade e horário.
- Classificação Qualis: nenhuma tabela foi importada. A UI mostra "classificação histórica indisponível". A tabela só entra com fonte verificável, ciclo e ressalva sobre a finalidade original.
- Instrumentos formais (RoB 2, GRADE, AMSTAR 2…) **não** são aplicados automaticamente. O sistema registra apenas "sinais preliminares de risco de viés", com `riskOfBias.status = not_assessed | preliminary_signals`.
