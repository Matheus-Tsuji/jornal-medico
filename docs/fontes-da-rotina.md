# Fontes da rotina diária

Lista viva: a rotina agendada lê este arquivo a cada execução e coleta **só o que está aqui**. Para acrescentar uma
fonte, acrescente uma linha na tabela (o prompt da rotina não muda).

## Como preencher cada linha

| Coluna | O que colocar |
|---|---|
| Nome | Nome da fonte |
| Tipo | `api` (já tem adaptador no pipeline), `rss` (feed público) ou `página` (HTML público lido pelo agente) |
| URL | Endereço público e oficial |
| Área | Tema ou área do site (ex.: Clínica médica, Odontologia, Saúde pública e regulação) |
| Como coletar | Uma frase: o que pegar e o que ignorar |
| Estado | `ativa`, `bloqueada` (a fonte recusa robô: não insistir) ou `pausada` |

## Regras da rotina para qualquer fonte
- Só página pública. Respeitar `robots.txt`; no máximo 1 requisição por segundo por domínio.
- Nunca burlar CAPTCHA, login, paywall ou bloqueio de robô. Fonte que bloqueia vira `bloqueada` e segue.
- Texto copiado de página oficial (título, identificação, ementa) é **literal**: nada de resumo nem interpretação jurídica.
- Fonte `página` entra pelo comando `npm run pipeline -s -- import-documents ARQUIVO.json` (mesma validação do cadastro
  do painel). Hoje esse caminho aceita os órgãos: `ms`, `digital`, `conitec`, `dou`, `planalto`, `senado`, `anvisa`.
  **Fonte de outro órgão exige acrescentar o órgão e seus domínios permitidos em `officialInput`
  (`apps/server/src/modules/monitor.ts`)**: não é só uma linha nesta tabela.

## Fontes já implementadas no código (tipo `api`)
| Nome | Tipo | URL | Área | Como coletar | Estado |
|---|---|---|---|---|---|
| PubMed | api | https://eutils.ncbi.nlm.nih.gov/ | Todas as áreas médicas | `pipeline cycle` (consulta por tema) | ativa |
| Europe PMC | api | https://www.ebi.ac.uk/europepmc/ | Todas as áreas médicas | `pipeline cycle` (só o que não está no PubMed) | ativa |
| SciELO via Crossref | api | https://api.crossref.org/ | Todas as áreas médicas | `pipeline cycle` (DOIs 10.1590) | ativa |
| Câmara dos Deputados | api | https://dadosabertos.camara.leg.br/ | Saúde pública e regulação | `pipeline monitor camara` | ativa |
| NEJM, JAMA, The Lancet, The BMJ | api | https://api.crossref.org/ | Publicações científicas | `pipeline monitor nejm` (e jama, lancet, bmj) | ativa |

## Fontes novas (a preencher pelo Matheus)
| Nome | Tipo | URL | Área | Como coletar | Estado |
|---|---|---|---|---|---|
| _(vazio: cole aqui as fontes novas)_ | | | | | |
