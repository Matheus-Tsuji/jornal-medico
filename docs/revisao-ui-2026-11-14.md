# Revisão da experiência do leitor — 14/11/2026

Público: médicos, residentes e estudantes buscando atualização com pouco tempo.
Direção: preservar a identidade editorial vinho/creme, EB Garamond nos títulos e Inter em controles e dados.

## Implementado
- Leitura de artigos com entrelinha maior, coluna de texto limitada e atalhos para métodos, resultados, limitações e rastreabilidade.
- Cabeçalho móvel mais compacto e botão de leitura rápida com nome acessível.
- Selos de evidência menos dominantes; explicação da classificação identifica a regra própria e sua diferença de uma avaliação GRADE.
- Prévias sem revisão identificadas também na landing; estados de carregamento e erro com nova tentativa.
- Falhas ao salvar, marcar leitura, dar feedback ou copiar passam a ter retorno visível.
- Registro de abertura distingue usuário e artigo durante navegação na mesma tela.
- Removida promessa de publicação no dia seguinte ao encerrar uma prévia.
- Configuração do servidor e ping aceitam apenas Terra e Luna. Extração local mudou de Sol para Terra.
- Sem novas dependências, alteração de conteúdo científico ou envio ao GitHub.

## Pendências
- Validação médica dos pesos de evidência e da qualidade de Terra/Luna.
- Conferência de variáveis da Vercel antes do próximo deploy: Sol será recusado.
- A passagem do segundo cérebro não estava disponível no caminho informado; não foi criada cópia paralela.
- Revisão com leitor de tela e testes com médicos continuam pendentes.

## Celular e tablet — prioridades altas
- Resultado principal e duas limitações aparecem antes dos metadados extensos.
- Autores, título original, identificadores e classificação continuam disponíveis em Sobre a publicação.
- Resultados usam o mesmo HTML semântico: blocos rotulados em telas menores que 1280 px e tabela em desktop.
- Coluna lateral do artigo só aparece a partir de 1280 px para preservar o espaço de leitura em tablets.
- Atalho no começo da edição leva diretamente ao resumo Em 1 minuto.
- Estado de revisão antecede a classificação automática, que deixou de usar a expressão evidência forte.
- Verificação: check passou (73 testes servidor, 7 Python); layouts verificados de 320 a 1440 px e texto ampliado em 125%.
