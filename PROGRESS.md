# PROGRESS — estado real

Última atualização: 2026-11-14.

## Implementado e testado
| Área | O que existe | Evidência |
|---|---|---|
| Monorepo | npm workspaces: `apps/server`, `apps/web`, `packages/contracts`, `services/recommender` | `npm run check` passa |
| Banco | SQLite via `libsql` (arquivo local com WAL; Turso remoto na Vercel), migrações SQL, seed idempotente, backup `VACUUM INTO` e cópia limpa para produção (`npm run db:export`) | teste de reinício + backup/restore |
| Deploy | Vercel via Build Output API (`npm run build:vercel`): estático + função da API + cron no lugar do worker; guia em `docs/deploy-vercel.md` | pacote testado localmente; build real na Vercel ok (site em jornal-medico.vercel.app); API aguardando variáveis de produção; **Turso real não testado** |
| Auth | OTP 6 dígitos por e-mail, HMAC no banco, uso único, expiração, 5 tentativas, cooldown, limites por e-mail/IP, sessão revogável, logout-all, sem enumeração | `auth.test.ts` (8 testes) |
| Leitor | Landing, entrar, onboarding em 3 passos, jornal (capa, Em 1 minuto, Para você, seções), edições anteriores, detalhe em duas camadas, explorar área→subárea→tema com filtros e cursor, salvos, histórico, mais lidos, preferências, privacidade (exportar/apagar/excluir), assinatura sandbox | e2e Playwright (8 testes) + capturas em `docs/screenshots/` |
| Editorial | Fila, revisão lado a lado com a fonte, edição de texto, aprovar/rejeitar/pedir ajustes com justificativa, versões imutáveis e correções visíveis, composição e publicação de edição, jobs, fontes, custos de IA, relatos, flags, planos, usuários, auditoria | `editorial.test.ts` + e2e |
| Ingestão | Adaptador PubMed real (ESearch/EFetch), janela sobreposta, cursor só avança no sucesso, deduplicação DOI→PMID→PMCID, candidatos a duplicata por título, triagem determinística, recheck de retratações | `ingestion.test.ts`; **teste ao vivo em 2026-11-14**: 30 encontrados, 5 ingeridos (PMIDs reais), 5 elegíveis |
| IA | Provedor HTTP da Responses API com JSON Schema estrito, prompts versionados (extração + redação), validador determinístico, retry limitado, bloqueio, idempotência por hash, orçamento (artigos/dia e USD), uso de tokens registrado | `ai.test.ts` (18 testes) com provedor falso; **chamada real à OpenAI não executada (sem chave)** |
| Recomendação | Baseline TS explicável com diversidade e "menos deste tema"; serviço Python (TF-IDF + mesmas regras) com fallback | `ranking-billing.test.ts`, `pytest` (7 testes), avaliação offline sintética |
| Billing | Planos em centavos editáveis, checkout sandbox, webhook HMAC sobre corpo bruto, idempotência, entitlement com carência, paywall configurável | `ranking-billing.test.ts` |
| Segurança | Ver `docs/architecture.md#segurança-implementada` | testes de CSRF, papéis, cabeçalhos, bundle sem segredos |

## Ciclo diário automático — 2026-11-16
- `runCycle` (`apps/server/src/worker/runner.ts`): agenda, coleta, analisa em paralelo e entrega. É usado pelo cron da Vercel, pelo worker e por `npm run pipeline -- cycle [segundos]`.
- Fila com prioridade (migração 006): coleta primeiro, depois metanálise/revisão sistemática, depois ensaio/diretriz, depois o resto. Análise com mais de 14 dias na fila expira com motivo.
- O limite diário de IA e a falta de chave **adiam** o job em vez de bloquear; o limite é respeitado também em paralelo.
- A busca lê a janela inteira por tema (até 200; antes cortava em 20). O NCBI recebe no máximo 2 req/s sem chave.
- A capa abre com o que entrou nas últimas 36 h e mostra "N novos".
- Testes: `test/daily-cycle.test.ts` simula dois dias seguidos, com mutações conferidas: sem a regra de novidade ou sem a reserva do limite, o teste falha. Resultado: Vitest 80/80, pytest 7/7, e2e 12/12.
- Ciclos reais no banco local em 2026-11-16:
  - Rodada 1 (orçamento de 240 s, durou 314 s): 25 dos 33 temas, 185 artigos novos, 22 análises. O NCBI barrou 8 temas com HTTP 429, que foram retentados.
  - Rodada 2 (orçamento de 180 s, durou 211 s): os 8 temas recuperados, 33 de 33 em dia, 260 artigos novos no total e 19 análises, das quais 14 de 18 com desenho identificado eram metanálises ou revisões sistemáticas. Nenhum job com erro.
- **Gargalo:** sobraram 219 análises na fila (96 metanálises ou revisões). Na Vercel Hobby (1 ciclo de cerca de 180 s por dia) cabem cerca de 20 análises por dia.

## Comandos executados (resultado em 2026-11-14, fim do dia)
- `npm run check` → lint ok, typecheck ok, Vitest 69/69, pytest 7/7, build ok
- Código no GitHub: `Matheus-Tsuji/jornal-medico` (privado), branch `main`
- `npm run test:e2e` (com `PW_CHROMIUM` apontando para o Chromium headless 1254 instalado; o Playwright 1.65.1 pede o 1255, que não está baixado) → 9/9
- Ingestão real com OpenAI, 5 áreas: 52 jobs `analyze` concluídos, 6 em andamento no fim da sessão; 48 análises reais `in_review` e 1 `blocked`
- Flags `real_content` e `ai_preview` ligadas no banco local (`/admin/flags`)

## Corrigido nesta rodada
- Limite global de requisições (300/min) contava arquivos estáticos; agora só conta `/api/`. Sem isso, o recarregamento no e2e (e leitores ativos) recebia `rate_limited` em vez da página.
- Barra de seções centralizada (`justify-center-safe`: centraliza quando cabe, rola a partir da esquerda quando não cabe).
- Datas: sem `ArticleDate`, a data da edição impressa no futuro cai para a data de entrada no PubMed (`sources/pubmed.ts` + migração `003_future_pubdates.sql`; teste em `ingestion.test.ts`).
- Cards: número bruto da fonte com separadores brasileiros (`brNums` em `web/src/lib/api.ts`) e sem linha "—" quando nada foi reportado.
- Força da evidência A1–C3 por estudo + Qualis CAPES 2021–2024 da revista; capa e edição ordenadas pelos mais bem avaliados (`modules/grade.ts`, `test/grade.test.ts`).
- Prompts `extraction.v2` (rótulos) e `editorial.v3` (frase `plainResult`); `PROMPT_VERSION = triage.v1+extraction.v2+editorial.v3`. Rascunho novo aposenta o rascunho anterior (`superseded`).

## Não validado / limitações conhecidas
- Nenhum e-mail real (Resend) enviado; nenhum gateway de pagamento real. Análises reais ainda **sem revisão médica**.
- Só PubMed. Europe PMC, Crossref, SciELO, sociedades e Conitec estão cadastradas como `planned`.
- Sem 2º fator para a equipe; sem CI; `npm audit` aponta 7 avisos moderados em dependências de desenvolvimento (minimatch via typescript-eslint).
- Acessibilidade testada de forma básica (link de pular, nomes de botões, foco, contraste medido); sem auditoria com leitor de tela.
- Referências NYT/NEJM/JAMA/Lancet/The News não foram navegadas (ver `docs/references.md`).
- Banco de desenvolvimento `data/journal.db` contém as análises reais acima (prévia rotulada "IA · não revisado por editor") e uma aprovação de teste do DEMO-009.

## Próximo passo específico
Médico responsável revisar as análises reais em `/admin/revisao` e publicar a primeira edição real; revogar a chave OpenAI que passou pelo chat. Lista completa em `docs/o-que-falta.md`.

## Ampliação de fontes — 2026-11-14
- /regulacao: proposições em saúde da Câmara via API, diretório de portais oficiais e cadastro literal de documentos por editor/admin.
- /publicacoes: descoberta de títulos/DOIs de NEJM, JAMA, The Lancet e The BMJ via Crossref. Não é análise científica nem acesso ao texto integral.
- Coleta real local sem IA: 100 proposições e 120 registros bibliográficos (30 por periódico).
- Migração 005, fila/cron, coleta manual via pipeline monitor e estado de atualização/erro por fonte.
- Cobertura parcial explícita: MS/Saúde Legis, Conitec, DOU, Planalto, Senado e Anvisa ainda por consulta oficial/cadastro editorial; sem promessa de cobrir todos os atos ou verificar vigência.
- Verificação: npm run check passou (78 testes servidor, 7 Python); suíte e2e com cadastro editorial e novas rotas em 320–1440 px.
- Alterações locais; não enviadas ao GitHub/Vercel. Detalhes em docs/fontes-oficiais.md.
