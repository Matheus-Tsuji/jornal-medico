# Referências de produto e design

Registro de 2026-11-14. Separado da coleta automatizada de artigos.

## 1. Artefato do fundador (prioridade máxima)
URL: `https://claude.ai/code/artifact/3af4ba32-6be9-4dae-938e-25ff0a37e25a#ia`

**O que foi acessado:** o HTML/CSS/JS publicado (87 KB) e o arquivo `mundo.json` (topologia de mapa-múndi).
**O que ficou inacessível:** o conteúdo das notícias. A página carrega a edição de um banco do runtime de artefatos (`window.claude.use("db")`), que não é legível por fora. Por isso a seção `#ia` não pôde ser vista renderizada; pelo código, `ia` é uma das seções temáticas do jornal ("O Matinal"), com cor própria (`--c-ia`).
**Nada foi copiado** (marca, textos, código). Só observamos padrões.

Padrões observados e adotados (adaptados):
- **Masthead que encolhe** ao rolar (logo grande → compacto), data e número da edição em linha de metadados.
- **Capa em grade de "lead"**: manchete grande à esquerda separada por fio vertical (`border-right`) de uma coluna secundária; seções separadas por fios horizontais finos, não por cards com sombra.
- **Painel de números** (`dl` com rótulos em versalete pequeno e valores com `font-variant-numeric: tabular-nums`) — reaproveitado como o bloco "Resultado principal" (medida, estimativa, IC, p).
- **Cor por seção** como marcador discreto (rótulo/kicker), não como fundo.
- Controles de leitura no topo: "Ouvir", modo "Rápido" e "Aa" (tamanho da fonte). Adotamos **Aa** e **Leitura rápida** (mostra só a camada rápida). "Ouvir" fica atrás de `FEATURE_AUDIO` (desligado: sem ElevenLabs configurado, o botão não aparece).
- Tipografia: serif de leitura (Source Serif 4) + sans de UI. O artefato usa uma display condensada em caixa-alta; aqui usamos a serif em peso alto, mais adequada ao tom de revista médica.
- Tema escuro por `prefers-color-scheme`, link "pular para o conteúdo", alvos de toque ≥ 44 px.

## 2. Referências complementares
Não foram navegadas nesta sessão (o briefing pede que a análise de concorrentes não adie a implementação). Padrões usados vêm do conhecimento prévio desses veículos e devem ser revistos com captura real:
- **The News / Matinal**: ritual diário, edição com começo e fim (sem feed infinito), tom leve → bloco "Em 1 minuto" e estado "edição concluída".
- **NYT / O Globo**: hierarquia de manchete única, coluna secundária, seções por fio → capa.
- **NEJM / JAMA / Lancet**: página do artigo com autoria, periódico, DOI, "Key points"/"Em poucas palavras", tabela de resultados → detalhe científico.
- **PubMed**: metadados bibliográficos (PMID, PMCID, tipos de publicação, MeSH) → modelo de dados, não layout.

## 3. Deficiências evitadas
- Grade de cards idênticos (cara de SaaS) → capa com hierarquia tipográfica.
- Verde como "resultado positivo" → resultados usam cor neutra; direção do efeito é descrita em texto.
- Gráficos ilustrativos → o gráfico de efeito só aparece com estimativa e IC reais e medida conhecida.
