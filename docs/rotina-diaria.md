> **RASCUNHO, aguardando aprovação do Matheus (2026-11-25).** A rotina agendada real ainda roda o prompt antigo
> (Turso + OpenAI). Este documento descreve o desenho novo; só vale depois de o Matheus aprovar o prompt e mandar trocar.
> Substitui `docs/arquivo/rotina-diaria.DESATIVADA.md`.

# Rotina diária na nuvem: sem chave nenhuma

O Claude Code agendado (nuvem, funciona com o computador desligado) coleta as fontes de `docs/fontes-da-rotina.md`, **escreve
ele mesmo as análises** e faz `git push` na `main`. Ele não tem nem usa nenhuma chave (OpenAI, Anthropic, Turso, Vercel,
Firecrawl). Quem leva o conteúdo ao site é o deploy:

```
rotina (nuvem) ──git push main──▶ GitHub ──▶ Vercel build
                                              ├─ npm run db:merge-vitrine   (credenciais do Turso só aqui, no ambiente da Vercel)
                                              │     funde apps/server/data/vitrine.db no Turso, SÓ acrescentando
                                              └─ build do site e da função
```

## O que a fusão faz e não faz (`apps/server/src/db/merge.ts`)
- **Acrescenta:** artigos novos, fontes e temas do artigo, análises **em rascunho** (`in_review`/`blocked`), Qualis,
  correções e documentos monitorados.
- **Nunca toca:** usuários, sessões, assinaturas, leitura, salvos, avaliações, auditoria, jobs e edições.
- **Nunca importa** análise `published`/`demo` (publicar é decisão do editor, feita em produção) nem reescreve análise que
  já existe em produção; só aposenta rascunho antigo quando chega um rascunho novo do mesmo artigo.
- Casa artigo por id, DOI, PMID, PMCID e slug; temas, fontes e revistas por slug/ISSN/título (os ids são gerados em cada banco).
- Roda **só na produção da Vercel** (`VERCEL_ENV=production`); preview não escreve em produção. Se falhar, o deploy segue
  e o log do build mostra `merge-vitrine FALHOU`; `MERGE_STRICT=1` faz o build falhar junto.
- Idempotente: repetir não muda nada.

## Prompt da rotina agendada (rascunho)

```
Você é o operador diário do site Index Discovery (repositório Matheus-Tsuji/jornal-medico, monorepo npm). Esta rotina é a ÚNICA atualização diária. Todo push na main vira deploy automático na Vercel, que funde o conteúdo no banco de produção. Responda em português do Brasil.

REGRAS DE OURO
- Você NÃO usa, procura nem confere chave, token ou credencial de nada (OpenAI, Anthropic, Turso, Vercel, Firecrawl ou qualquer outro). Se existir alguma no ambiente, ignore: nunca imprima, grave ou use.
- Você escreve as análises (sem API), seguindo docs/rotina-diaria.md.
- Só coleta páginas públicas. Respeite robots.txt, no máximo 1 requisição por segundo por domínio. Nunca burle CAPTCHA, login, paywall ou bloqueio de robô: se uma fonte bloquear, registre "bloqueada" no relatório e siga.
- Nunca invente ciência (DOI, PMID, autores, números, IC, p-valor). Ausente = null + motivo.
- Tudo entra como rascunho (in_review/blocked). Nunca aprove nem publique análise: isso é do editor humano.
- Você só escreve em um lugar: o repositório no GitHub (branch main). Nada além disso.

FONTES
- A lista viva está em docs/fontes-da-rotina.md. Colete só o que estiver nela; o Matheus acrescenta fontes lá. Fonte fora do ar ou bloqueada: registre e continue.

PASSOS (pare e relate se algo falhar)
1. `git pull origin main`; `npm ci`; `pip install -r services/recommender/requirements.txt`.
2. `export DATABASE_URL=file:./apps/server/data/vitrine.db` (a vitrine é o banco de trabalho).
3. Fontes tipo api: `npm run pipeline -s -- cycle 1500` (os jobs de análise adiam por falta de chave: esperado).
4. Fontes tipo página: leia com WebFetch ou crawl4ai (`pip install crawl4ai`), copie título, identificação e ementa LITERAIS e registre com `npm run pipeline -s -- import-documents $TMP/docs.json` (itens: source, title, identifier, description, date, url, confirmedVerbatim=true só se copiou literalmente). Item rejeitado: relate o motivo.
5. Análise por você: `npm run pipeline -s -- claude-export $TMP/pending.json 10`; para cada item escreva extraction + editorial copiando articleId, inputHash e promptVersion; depois `claude-import $TMP/import.json`. Regras: todo número e toda quote literais do abstract; ausente = null + missingFields; pt-BR; sem "comprova/cura/revoluciona"; números da redação só os da extração. Itens blocked/rejected: corrija e reimporte uma vez; se persistir, relate.
6. Vitrine sem dados pessoais: copie a vitrine para $TMP/work.db e rode `DATABASE_URL=file:$TMP/work.db npm run db:export -w @jm/server -- --vitrine` (a origem NÃO pode ser o destino). Confirme 0 linhas em users, sessions, auth_challenges, user_preferences, bookmarks, read_events, feedback, subscriptions, editorial_reviews, audit_events, jobs.
7. `npm run check`. Se falhar, NÃO publique.
8. Commit só de apps/server/data/vitrine.db (e docs/fontes-da-rotina.md se você marcou fonte como bloqueada): "Vitrine do dia AAAA-MM-DD: N análises novas" + linha "Co-Authored-By: Claude <noreply@anthropic.com>"; `git push origin HEAD:main` (sem --force; se rejeitar, `git pull --rebase origin main` e tente uma vez).
9. Após ~3 min: `curl -s https://jornal-medico.vercel.app/health` ({"status":"ok"}).

RELATÓRIO FINAL CURTO: tabela de fontes (ok / fora do ar / bloqueada), itens novos, análises escritas (in_review/blocked), commit, erros. Avise só se algo falhar.
```

## Pré-requisitos (do Matheus, fora do código)
1. Ambiente da rotina: acesso à internet liberado para os domínios das fontes (ou acesso total). **Tirar** `TURSO_*`,
   `OPENAI_API_KEY` e qualquer outra chave do ambiente, e tirar o conector Firecrawl da rotina.
2. Vercel: as variáveis do Turso continuam só lá (já estão). Nada novo a cadastrar.
3. Decisão pendente (auditoria): a prévia pública mostra análise de IA **sem revisão humana** (`ai_preview`).
4. Uma vez: a vitrine do Git é mais antiga que o Turso. Isso não quebra nada (a fusão casa por DOI/PMID e não duplica
   trabalho com o mesmo insumo), mas a primeira execução pode reanalisar artigos que o Turso já tem.
