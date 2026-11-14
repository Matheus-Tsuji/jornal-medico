# O que falta fazer

Lista criada em 2026-11-14, com o trabalho **pausado** a pedido do Matheus.

## 1. Interrompido no meio — concluído em 2026-11-14
- [x] Ingestão real: 52 análises concluídas, 6 ainda rodando em processos `pipeline run` antigos (o lease de 5 min devolve à fila se morrerem). 48 reais em revisão, 1 bloqueada.
- [x] Flag `ai_preview` criada (`npm run db:seed`); `real_content` e `ai_preview` ligadas em `/admin/flags`.
- [x] `npm run check` (64 + 7 testes, build) e `npm run test:e2e` 9/9. O e2e precisa de `PW_CHROMIUM` apontando para o Chromium headless 1254 já instalado. Corrigido no caminho: o limite global de requisições contava arquivos estáticos e derrubava recarregamentos.

## 2. Interface
- [x] Barra de seções centralizada (centraliza quando cabe; no celular continua rolando a partir da esquerda).
- [x] Gráfico de efeito conferido com artigo real (GLP-1, 4 desfechos): nomes completos, números ao lado, sem corte a 1440 px e 375 px.
- [x] Linha de resultado nos cards conferida. Corrigido: número copiado da fonte agora sai com vírgula decimal ("301,0 → 1443,0"); card sem resultado reportado não mostra mais "…: —"; datas de edição impressa no futuro (11 artigos com "1 de jan. de 2027") passam a usar a data de entrada no PubMed (parser + migração `003`).
- [ ] Rótulos escritos pela IA às vezes saem truncados ou mistos ("150 de 190 78,9%", "Mediana; intervalo interquartil… 29 anos", "recruits per month"). É texto do modelo, não do formatador: corrigir na revisão editorial ou numa nova versão do prompt de redação.
- [x] Capa em modo prévia com artigos reais, conferida a 1440 px e 375 px, sem rolagem lateral e com aviso "Prévia automática".
- [ ] "Edições" e "Mais lidos" ficam vazios com conteúdo real até existir uma edição publicada e leitores suficientes. Decidir se a prévia aparece em "Edições".
- [ ] Rever se as buscas das áreas novas trazem estudos pertinentes. A triagem excluiu 2 de 58; vale amostrar com um médico.

## 3. Editorial (precisa de pessoa)
- [ ] Médico responsável revisar as análises reais em `/admin/revisao` e publicar a primeira edição real.
- [ ] Definir quem são os editores e os critérios escritos de aprovação.

## 4. Depende do Matheus (contas e decisões)
- [ ] **Revogar a chave da OpenAI que foi enviada no chat** e colocar uma nova no `.env`.
- [ ] E-mail real: conta no Resend (ou outro) com domínio verificado. Hoje o código aparece na tela (modo de teste).
- [ ] Gateway de pagamento real (hoje só sandbox).
- [ ] Repositório Git e hospedagem (nada foi versionado nem publicado).
- [ ] Nome e logo definitivos (os atuais são temporários).
- [ ] Demais itens em [pendencias-fundadores.md](pendencias-fundadores.md) (preço, licenças, LGPD).

## 5. Técnico (pode esperar)
- [ ] Segundo fator de login para a equipe editorial.
- [ ] Limpeza automática de contas de visitante inativas.
- [ ] Com a prévia ligada, um artigo com versão publicada **e** correção em revisão pode aparecer duas vezes nas listas.
- [ ] Notion, ClickUp, áudio, vídeo e PWA: não implementados (flags desligadas).
- [ ] 7 avisos moderados do `npm audit` (só em ferramentas de desenvolvimento).
- [x] `PROGRESS.md` e a nota da sessão no cofre atualizados (2026-11-14).
- [ ] Atualizar o Chromium do Playwright (`npx playwright install chromium`) para não depender de `PW_CHROMIUM`.
