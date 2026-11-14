# Documentos oficiais e descoberta bibliográfica
Implementação em 14/11/2026.

## Áreas
- /regulacao: documentos oficiais da saúde brasileira, sem cobertura jornalística.
- /publicacoes: títulos e DOI de NEJM, JAMA, The Lancet e The BMJ via Crossref.
- /jornal: análises científicas do fluxo editorial existente.

## Cobertura real
A Câmara é coletada pela API de Dados Abertos: tema Saúde (código 56), até 100 proposições mais recentes por execução. Não é acompanhamento integral da tramitação; a situação atual deve ser conferida na ficha oficial.
Crossref: 30 registros por periódico e por execução, incluindo tipos editoriais que ainda não passaram por triagem clínica. Não fornece autorização para republicar texto integral.
As coletas acumulam registros deduplicados no banco. A interface consulta no máximo 1000 registros por área e oferece busca local e carregamento em lotes de 30.

Saúde Legis / Ministério, Saúde Digital, Conitec, DOU, Planalto, Senado e Anvisa são canais de consulta oficial e cadastro editorial, não adaptadores automáticos. Acesso automatizado ao portal do Ministério retornou HTTP 401 nesta sessão; NEJM RSS retornou HTTP 403. Não houve tentativa de contornar esses controles.
Não há cobertura completa de todos os atos federais, estaduais, municipais ou decisões judiciais. Projetos não são apresentados como leis vigentes. Não se infere vigência, revogação, impacto, autoria ou efeito jurídico.

## Cadastro
Editor/admin usa o formulário em /regulacao. Só título, identificação e ementa/trecho literal com link HTTPS do órgão permitido. Confirmação da transcrição é obrigatória. Data ausente permanece null; URLs são validadas mas nunca buscadas. Cadastro gera auditoria.
Este cadastro publica metadados da fonte, não uma análise jurídica. Análises científicas continuam exigindo revisão editorial e aprovação.

## Operação
- npm run pipeline -- monitor: coleta todas as fontes implementadas, sem IA.
- npm run pipeline -- monitor camara (ou nejm, jama, lancet, bmj): coleta uma fonte.
- Worker e cron agendam as cinco fontes em quatro janelas diárias; execução efetiva depende do agendamento e fila.
- Equipe pode enfileirar pelo botão Agendar coleta em Fontes e cobertura e acompanhar em /admin/jobs.
- Falha de coleta mantém registros anteriores e avisa na interface.
- Vercel: requer Turso persistente e CRON_SECRET; a vitrine efêmera já existente não executa cron.

## Fontes verificadas
- https://dadosabertos.camara.leg.br/swagger/api.html
- https://dadosabertos.camara.leg.br/api/v2/referencias/proposicoes/codTema
- https://www.crossref.org/documentation/retrieve-metadata/rest-api/
- https://www.gov.br/saude/pt-br/acesso-a-informacao/institucional/legislacao/legislacao
- https://www.gov.br/saude/pt-br/composicao/seidigi/legislacao
- https://www.gov.br/conitec/pt-br/assuntos/avaliacao-de-tecnologias-em-saude/recomendacoes-da-conitec
Consultadas em 14/11/2026.

## Próximos passos
- Validar canais autorizados de coleta contínua do DOU, Saúde Legis, Senado e Anvisa.
- Ampliar paginação e acompanhamento de tramitação com cursores por fonte.
- Vincular a descoberta Crossref ao pipeline clínico apenas quando houver abstract/texto autorizado e desenho elegível.
- Avaliação de relevância temática por editor; filtro de tecnologia atual usa palavras explícitas da fonte.
